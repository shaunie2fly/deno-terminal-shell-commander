/**
 * Remote Shell Client Implementation
 *
 * Provides a client for connecting to remote shell instances
 * @module
 */

import { EventEmitter } from 'node:events';
import { AuthCredentials, AuthType, ClientEvent, InputMessage, MessageType, ProtocolMessage, ProtocolMessageRT } from './protocol.ts'; // Added InputMessage

/**
 * Configuration options for the shell client
 */
export interface ShellClientOptions {
	/** TCP port to connect to */
	port?: number;
	/** Host address to connect to (defaults to localhost) */
	host?: string;
	/** Unix domain socket path for IPC (optional) */
	socketPath?: string;
	/** Authentication credentials */
	auth?: AuthCredentials;
	/** Connection type (defaults to tcp) */
	connectionType?: 'tcp' | 'unix';
	/** Auto reconnect on disconnect */
	autoReconnect?: boolean;
	/** Reconnect delay in milliseconds (defaults to 5000) */
	reconnectDelay?: number;
	/** Maximum reconnect attempts (defaults to 5) */
	maxReconnectAttempts?: number;
}

/**
 * Client for connecting to remote shell instances
 */
export class ShellClient {
	private options: ShellClientOptions;
	private eventEmitter = new EventEmitter();
	private connection?: Deno.Conn;
	private connected = false;
	private authenticated = false;
	private sessionId?: string;
	private reconnectAttempts = 0;
	private reconnectTimeoutId?: number;
	private outputStream: TransformStream<string, string>;
	private outputWriter: WritableStreamDefaultWriter<string>;
	private inputStream: TransformStream<string, string>;
	private inputReader: ReadableStreamDefaultReader<string>;
	private pendingCommands = new Map<string, { // Keep for potential future request/response pairs other than commands
		resolve: (value: unknown) => void;
		reject: (reason: unknown) => void;
	}>();

	/**
	 * Create a new shell client
	 * @param options - Configuration options for the client
	 */
	constructor(options: ShellClientOptions) {
	// console.log('[ShellClient] Creating instance with options:', options);
		// Set defaults for optional parameters
		this.options = {
			...options,
			host: options.host || 'localhost',
			connectionType: options.connectionType || 'tcp', // Default to tcp
			autoReconnect: options.autoReconnect ?? true,
			reconnectDelay: options.reconnectDelay || 5000,
			maxReconnectAttempts: options.maxReconnectAttempts || 5,
		};

		// Create streams for input and output
		// Output from server -> outputStream -> client application reads
		this.outputStream = new TransformStream<string, string>();
		this.outputWriter = this.outputStream.writable.getWriter();

		// Input from client application -> inputStream -> processInputStream -> server
		this.inputStream = new TransformStream<string, string>();
		this.inputReader = this.inputStream.readable.getReader();
		// console.log('[ShellClient] Instance created and streams initialized.');
}

	/**
	 * Connect to the remote shell server
	 * @returns Promise that resolves when connected and authenticated
	 */
	public async connect(): Promise<void> {
		if (this.connected) {
		// console.log('[ShellClient.connect] Already connected.');
  return;
 }

	// console.log('[ShellClient.connect] Attempting connection...');
		try {
			// Establish connection based on the connection type
			if (this.options.connectionType === 'unix' && this.options.socketPath) {
		// console.log(`[ShellClient.connect] Connecting via Unix socket: ${this.options.socketPath}`);
				await this.connectUnixSocket();
			} else if (this.options.port) { // Default to TCP if port is specified
		// console.log(`[ShellClient.connect] Connecting via TCP: ${this.options.host}:${this.options.port}`);
   await this.connectTcp();
  } else {
		console.error('[ShellClient.connect] Invalid connection options provided.');
				throw new Error('Invalid connection options: must specify port for TCP or socketPath for Unix');
			}

	// console.log('[ShellClient.connect] Connection established.');
			this.connected = true;
			this.reconnectAttempts = 0;

			// Start message processing loop (receives messages from server)
			this.processMessages().catch(this.handleConnectionError.bind(this));

			// Authenticate if needed
			if (this.options.auth) {
				await this.authenticate(); // This emits CONNECT event on success
			} else {
		// console.log('[ShellClient.connect] No authentication required. Emitting CONNECT event.');
				// No authentication needed
				this.authenticated = true;
				this.emitEvent(ClientEvent.CONNECT, { authenticated: true });
			}

			// --- Start Input Stream Processing ---
			// After connection and potential authentication, start reading from the input stream
			// and sending data to the server.
			this.processInputStream().catch((err: unknown) => { // Add type to err
				console.error("[ShellClient] Error processing input stream:", err);
				this.handleConnectionError(err);
			});
			// -------------------------------------

		} catch (error) {
			this.handleConnectionError(error); // Handles emitting error and disconnect
	console.error('[ShellClient.connect] Connection failed:', error);
			// No need to throw again if handleConnectionError manages state
		}
	}


	/**
	 * Connect via Unix domain socket
	 */
	private async connectUnixSocket(): Promise<void> {
	// console.log('[ShellClient.connectUnixSocket] Attempting connection...');
		try {
			const conn = await Deno.connect({
				path: this.options.socketPath!,
				transport: 'unix',
			});
			this.connection = conn;
		} catch (error) {
		console.error('[ShellClient.connectUnixSocket] Connection failed:', error);
			throw new Error(`Unix socket connection failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
	 * Connect via TCP
	 */
	private async connectTcp(): Promise<void> {
	// console.log('[ShellClient.connectTcp] Attempting connection...');
		try {
			const conn = await Deno.connect({
				hostname: this.options.host,
				port: this.options.port!,
			});
			this.connection = conn;
		} catch (error) {
		console.error('[ShellClient.connectTcp] Connection failed:', error);
			throw new Error(`TCP connection failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
	 * Authenticate with the server
	 */
	private async authenticate(): Promise<void> {
	// console.log('[ShellClient.authenticate] Starting authentication...');
		const authType = this.getAuthType();

		const authRequest: ProtocolMessage = {
			id: crypto.randomUUID(),
			type: MessageType.AUTH_REQUEST,
			timestamp: Date.now(),
			payload: {
				authType,
				username: this.options.auth?.username,
				password: this.options.auth?.password,
				token: this.options.auth?.token,
			},
		};

	// console.log(`[ShellClient.authenticate] Sending auth request with type: ${authType}`);
		// Send authentication request
		try {
			const response = await this.sendAndWaitForResponse(authRequest, MessageType.AUTH_RESPONSE);

			// Type guard to ensure we have an AuthResponseMessage
			if (response.type === MessageType.AUTH_RESPONSE) {
				if (response.payload.success) {
			// console.log(`[ShellClient.authenticate] Authentication successful. Session ID: ${response.payload.sessionId}`);
					this.authenticated = true;
					this.sessionId = response.payload.sessionId;
					this.emitEvent(ClientEvent.CONNECT, { authenticated: true, sessionId: this.sessionId }); // Emit CONNECT here after auth success
				} else {
			console.error(`[ShellClient.authenticate] Authentication failed: ${response.payload.error || 'Unknown error'}`);
					throw new Error(`Authentication failed: ${response.payload.error || 'Unknown error'}`);
				}
			} else {
				// This shouldn't happen if sendAndWaitForResponse works correctly
				console.error(`[ShellClient.authenticate] Unexpected response type received: ${response.type}`);
				throw new Error(`Authentication failed: Unexpected response type ${response.type}`);
			}
		} catch (error) {
		console.error('[ShellClient.authenticate] Error during authentication:', error);
			this.authenticated = false;
			// Let the error propagate up to connect() which calls handleConnectionError
			throw error;
		}
	}

	/**
	 * Determine the authentication type based on provided credentials
	 */
	private getAuthType(): AuthType {
	// console.log('[ShellClient.getAuthType] Determining authentication type...');
 if (this.options.auth?.token) {
		// console.log('[ShellClient.getAuthType] Using TOKEN authentication.');
  return AuthType.TOKEN;
 } else if (this.options.auth?.username && this.options.auth?.password) {
		// console.log('[ShellClient.getAuthType] Using BASIC authentication.');
  return AuthType.BASIC;
 } else {
		// console.log('[ShellClient.getAuthType] Using NONE authentication.');
			return AuthType.NONE;
		}
	}

	/**
	 * Process incoming messages from the server (runs in background)
	 */
	private async processMessages(): Promise<void> {
	// console.log('[ShellClient.processMessages] Starting message processing loop.');
 if (!this.connection) {
		console.error('[ShellClient.processMessages] No connection available. Aborting.');
			return; // Should not happen if called correctly after connect
		}

		const conn = this.connection;
		const buffer = new Uint8Array(4096);
		let leftover = '';

		try {
			while (this.connected) {
   const n = await conn.read(buffer);
   if (n === null) {
			// console.log('[ShellClient.processMessages] Connection closed by peer (read returned null).');
    this.handleDisconnect('End of stream');
    break;
   }

				const chunk = new TextDecoder().decode(buffer.subarray(0, n));
				const lines = (leftover + chunk).split('\n');
				leftover = lines.pop() || ''; // Keep incomplete line for next read

				for (const line of lines) {
					if (line.trim()) {
						this.handleMessage(line);
					}
				}
			}
		} catch (error) {
			// Only handle error if still connected (avoid double handling on disconnect)
			if (this.connected) {
			    this.handleConnectionError(error);
		        console.error('[ShellClient.processMessages] Error during message processing:', error);
			} else {
				// console.log('[ShellClient.processMessages] Ignoring read error on already disconnected client.');
			}
		} finally {
			// console.log('[ShellClient.processMessages] Exiting message processing loop.');
		}
	}

	/**
	 * Handle a single incoming message line
	 */
	private handleMessage(messageText: string): void {
	// // console.log(`[ShellClient.handleMessage] Raw message received: ${messageText}`); // Can be verbose
		try {
			const message = JSON.parse(messageText);
			// Use Runtypes for robust validation
			const validationResult = ProtocolMessageRT.validate(message);

			if (!validationResult.success) {
		console.warn('[ShellClient.handleMessage] Invalid message format received:', validationResult.message, 'Original text:', messageText);
				this.emitEvent(ClientEvent.ERROR, {
					message: 'Invalid message format',
					details: validationResult.message,
				});
				return;
			}

			const validatedMessage = validationResult.value; // Use validated message

			// Process based on message type
	// console.log(`[ShellClient.handleMessage] Processing message type: ${validatedMessage.type}, ID: ${validatedMessage.id}`);
			switch (validatedMessage.type) {
				case MessageType.AUTH_RESPONSE:
		// console.log('[ShellClient.handleMessage] Resolving promise for AUTH_RESPONSE.');
					this.resolvePromise(validatedMessage);
					break;

				case MessageType.COMMAND_RESPONSE: // Keep for potential non-shell commands
		// console.log(`[ShellClient.handleMessage] Resolving promise for COMMAND_RESPONSE (ID: ${validatedMessage.id}).`);
    this.resolvePromise(validatedMessage);
    break;

   case MessageType.OUTPUT:
		// Write to the output stream which the client application consumes
					this.outputWriter.write(validatedMessage.payload.content).catch((error) => {
			console.error('[ShellClient.handleMessage] Error writing to output stream:', error);
						this.emitEvent(ClientEvent.ERROR, {
							message: 'Failed to write to output stream',
							error,
						});
					});

					// Also emit an output event for direct listeners
					this.emitEvent(ClientEvent.OUTPUT, {
						content: validatedMessage.payload.content,
						// commandId might be less relevant now, using a generic one from server
						commandId: validatedMessage.payload.commandId,
						final: validatedMessage.payload.final,
					});
					break;

				case MessageType.ERROR:
		console.error(`[ShellClient.handleMessage] Received ERROR message from server: ${validatedMessage.payload.message} (Code: ${validatedMessage.payload.code})`);
					// Emit error event
					this.emitEvent(ClientEvent.ERROR, {
						message: validatedMessage.payload.message,
						code: validatedMessage.payload.code,
					});
					break;

				case MessageType.DISCONNECT:
					// Type guard for DisconnectMessage payload
					if (validatedMessage.type === MessageType.DISCONNECT) {
						const reason = validatedMessage.payload?.reason ?? 'Unknown reason';
						// console.log(`[ShellClient.handleMessage] Received DISCONNECT message. Reason: ${reason}`);
						this.handleDisconnect(reason);
					} else {
						// Should not happen due to switch case, but satisfies TS stricter checks
						console.error("[ShellClient.handleMessage] Mismatched type in DISCONNECT case.");
					}
					break;

				case MessageType.PING:
		// console.log('[ShellClient.handleMessage] Received PING, sending PONG.');
					// Respond with pong
					this.sendMessage({
						id: crypto.randomUUID(),
						type: MessageType.PONG,
						timestamp: Date.now(),
						payload: {
							uptime: 0, // Client doesn't track uptime
						},
					}).catch(this.handleConnectionError.bind(this));
					break;

				case MessageType.PONG:
    // Nothing to do for pong response, maybe track latency later
    break;

                // INPUT messages are sent *by* the client, not received
				// case MessageType.INPUT:
				//	 console.warn('[ShellClient.handleMessage] Received INPUT message unexpectedly.');
				//	 break;

   default:
		// This should ideally not happen with Runtypes validation, but good for safety
		console.warn(`[ShellClient.handleMessage] Unhandled message type received: ${(validatedMessage as any).type}`);
					this.emitEvent(ClientEvent.ERROR, {
						message: `Unhandled message type: ${(validatedMessage as any).type}`,
					});
					break;
			}
		} catch (error) {
			console.error('[ShellClient.handleMessage] Error parsing or handling message:', error, 'Original text:', messageText);
			this.emitEvent(ClientEvent.ERROR, {
				message: 'Error processing message',
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	/**
	 * Resolve a pending promise for a message response (e.g., for Auth)
	 */
	private resolvePromise(message: ProtocolMessage): void {
	// console.log(`[ShellClient.resolvePromise] Attempting to resolve promise for message ID: ${message.id}`);
		const requestId = message.id; // Use the ID from the response which should match original request
		const pendingRequest = this.pendingCommands.get(requestId);

		if (pendingRequest) {
		// console.log(`[ShellClient.resolvePromise] Found pending request for ID ${requestId}. Resolving.`);
  pendingRequest.resolve(message); // Resolve with the full validated message
  this.pendingCommands.delete(requestId);
	} else {
		// This might happen if a response arrives after a timeout, or it's an unsolicited response
		console.warn(`[ShellClient.resolvePromise] No pending request found for message ID: ${requestId}. Might be a duplicate or late response.`);
		}
	}

	/**
	 * Send a message to the server and wait for a specific response type.
	 * Used primarily for Auth request/response flow.
	 * @param message - The message to send
	 * @param expectedResponseType - The expected response message type
	 * @param timeout - Timeout in milliseconds (defaults to 30000)
	 * @returns Promise that resolves with the validated response message
	 */
	private sendAndWaitForResponse(message: ProtocolMessage, expectedResponseType: MessageType, timeout = 30000): Promise<ProtocolMessage> {
	// console.log(`[ShellClient.sendAndWait] Sending message ID ${message.id}, Type: ${message.type}. Expecting ${expectedResponseType}. Timeout: ${timeout}ms.`);
 return new Promise((resolve, reject) => {
  // Set up timeout
  const timeoutId = setTimeout(() => {
		console.warn(`[ShellClient.sendAndWait] Timeout waiting for ${expectedResponseType} response for message ID ${message.id}.`);
				this.pendingCommands.delete(message.id);
				reject(new Error(`Timeout waiting for ${expectedResponseType} response`));
			}, timeout);

			// Store the promise resolvers
			this.pendingCommands.set(message.id, {
				resolve: (response) => { // response is expected to be a ProtocolMessage object passed from resolvePromise
					clearTimeout(timeoutId);
					const validatedResponse = response as ProtocolMessage; // Assume resolvePromise gives correct type
		// console.log(`[ShellClient.sendAndWait] Received response for message ID ${message.id}. Validating type...`);

    if (validatedResponse.type !== expectedResponseType) {
			console.error(`[ShellClient.sendAndWait] Unexpected response type for ID ${message.id}. Expected ${expectedResponseType}, got ${validatedResponse.type}.`);
     reject(new Error(`Expected ${expectedResponseType}, got ${validatedResponse.type}`));
    } else {
			// console.log(`[ShellClient.sendAndWait] Response validated for ID ${message.id}. Resolving promise.`);
     resolve(validatedResponse); // Resolve with the validated message
    }
   },
   reject: (error) => {
    clearTimeout(timeoutId);
		console.error(`[ShellClient.sendAndWait] Promise rejected for message ID ${message.id}:`, error);
					reject(error);
				},
			});

			// Send the message
			this.sendMessage(message).catch((error) => {
				clearTimeout(timeoutId);
		console.error(`[ShellClient.sendAndWait] Error sending message ID ${message.id}:`, error);
				this.pendingCommands.delete(message.id); // Clean up if send fails
				reject(error);
			});
		});
	}

	/**
	 * Send a message to the server (fire-and-forget, handles encoding)
	 * @param message - The message to send
	 */
	private async sendMessage(message: ProtocolMessage): Promise<void> {
	// // console.log(`[ShellClient.sendMessage] Preparing to send message ID: ${message.id}, Type: ${message.type}`); // Can be verbose
 if (!this.connected || !this.connection) {
		console.error(`[ShellClient.sendMessage] Attempted to send message ID ${message.id} while not connected.`);
			throw new Error('Not connected to server');
		}

		try {
			// Send over TCP or Unix socket, ensuring newline termination
			const data = new TextEncoder().encode(JSON.stringify(message) + '\n');
			await this.connection.write(data);
		} catch (error) {
			console.error(`[ShellClient.sendMessage] Error writing message ID ${message.id} to connection:`, error);
			// Connection error likely, trigger disconnect/reconnect logic
			this.handleConnectionError(error);
			throw error; // Re-throw to signal failure to caller if needed (e.g., sendAndWait)
		}
	}

	/**
	 * Send input data to the remote shell.
	 * @param data - The string data to send (e.g., characters typed by the user).
	 */
	public async sendInput(data: string): Promise<void> {
		// // console.log(`[ShellClient.sendInput] Sending input data: ${data.substring(0,50)}...`); // Can be verbose
		if (!this.connected) {
			console.error('[ShellClient.sendInput] Cannot send input: Not connected.');
			throw new Error('Not connected to server');
		}
		if (!this.authenticated || !this.sessionId) {
			console.error('[ShellClient.sendInput] Cannot send input: Not authenticated.');
			throw new Error('Not authenticated');
		}

		const inputMessage: ProtocolMessage = {
			id: crypto.randomUUID(),
			type: MessageType.INPUT,
			timestamp: Date.now(),
			payload: {
				data,
				sessionId: this.sessionId,
			},
		};

		// Use sendMessage which handles errors and connection state
		await this.sendMessage(inputMessage);
		// // console.log(`[ShellClient.sendInput] Input message ${inputMessage.id} sent successfully.`); // Can be verbose
	}

	// Removed executeCommand method as it's replaced by input/output streams

	/**
	 * Get the output stream for shell output.
	 * The application using the client reads from this stream.
	 * @returns ReadableStream of output content received from the server.
	 */
	public getOutputStream(): ReadableStream<string> {
		return this.outputStream.readable;
	}

	/**
	 * Get the input stream for sending input to the shell.
	 * The application using the client writes to this stream.
	 * @returns WritableStream for input. Data written here is processed by `processInputStream`.
	 */
	public getInputStream(): WritableStream<string> {
		return this.inputStream.writable;
	}

	/**
	 * Handle a connection error (e.g., read/write failure)
	 */
	private handleConnectionError(error: unknown): void {
	console.error('[ShellClient.handleConnectionError] Handling connection error:', error);
		this.emitEvent(ClientEvent.ERROR, {
			message: 'Connection error',
			error: error instanceof Error ? error.message : String(error),
		});

		// Trigger disconnection process if not already disconnected
		if (this.connected) {
		    this.handleDisconnect('Connection error');
		}
	}

	/**
	 * Handle disconnection from the server (initiated by server, error, or locally)
	 */
	private handleDisconnect(reason: string): void {
	// console.log(`[ShellClient.handleDisconnect] Handling disconnection. Reason: ${reason}`);
 if (!this.connected) {
		// // console.log('[ShellClient.handleDisconnect] Already disconnected.'); // Can be verbose
			return;
		}

		this.connected = false;
		this.authenticated = false;
		this.sessionId = undefined;

		// Close the connection if it's still open
		if (this.connection) {
			try {
		// console.log('[ShellClient.handleDisconnect] Closing underlying connection.');
   this.connection.close();
  } catch {
   // Ignore errors during close
		console.warn('[ShellClient.handleDisconnect] Error ignored during connection close.');
  }
  this.connection = undefined;
 }

 // Reject all pending commands/requests
	// console.log(`[ShellClient.handleDisconnect] Rejecting ${this.pendingCommands.size} pending commands.`);
		for (const [id, { reject }] of this.pendingCommands) {
			reject(new Error('Disconnected from server'));
		}
		this.pendingCommands.clear();

		// Close the streams to signal end to consumers/producers
		// Use try-catch as they might already be closing
		try { this.outputWriter.close(); } catch { /* ignore */ }
		try { this.inputStream.writable.abort(reason); } catch { /* ignore */ } // Abort writable side


		// Emit disconnect event
	// console.log('[ShellClient.handleDisconnect] Emitting DISCONNECT event.');
		this.emitEvent(ClientEvent.DISCONNECT, { reason });

		// Attempt reconnection if enabled
		if (
			this.options.autoReconnect &&
			this.reconnectAttempts < (this.options.maxReconnectAttempts || 5)
		) {
			this.scheduleReconnect();
		}
	}

	/**
	 * Schedule a reconnection attempt
	 */
	private scheduleReconnect(): void {
	// console.log(`[ShellClient.scheduleReconnect] Scheduling reconnection attempt ${this.reconnectAttempts + 1}...`);
 if (this.reconnectTimeoutId) {
		// console.log('[ShellClient.scheduleReconnect] Clearing existing reconnect timeout.');
  clearTimeout(this.reconnectTimeoutId);
 }

 this.reconnectAttempts++;
 const delay = this.options.reconnectDelay || 5000;
	// console.log(`[ShellClient.scheduleReconnect] Attempt ${this.reconnectAttempts}/${this.options.maxReconnectAttempts || 5} scheduled in ${delay}ms.`);

 this.reconnectTimeoutId = setTimeout(async () => {
  this.reconnectTimeoutId = undefined; // Clear ID before attempting
  try {
		// console.log(`[ShellClient.scheduleReconnect] Executing reconnection attempt ${this.reconnectAttempts}.`);
   await this.connect();
		// If connect succeeds, reconnectAttempts is reset inside connect()
		// console.log(`[ShellClient.scheduleReconnect] Reconnection attempt ${this.reconnectAttempts} successful.`);
  } catch (err){ // Catch error from connect()
		console.error(`[ShellClient.scheduleReconnect] Reconnection attempt ${this.reconnectAttempts} failed:`, err instanceof Error ? err.message : err);
				// handleConnectionError is called within connect(), which might trigger another scheduleReconnect if attempts remain.
			}
		}, delay);
	}

	/**
	 * Disconnect from the server manually
	 */
	public async disconnect(): Promise<void> {
	// console.log('[ShellClient.disconnect] Manual disconnect initiated.');
 if (!this.connected) {
		// console.log('[ShellClient.disconnect] Already disconnected.');
			return;
		}

		// Cancel any pending reconnection attempts
		if (this.reconnectTimeoutId) {
		// console.log('[ShellClient.disconnect] Cancelling scheduled reconnect.');
			clearTimeout(this.reconnectTimeoutId);
			this.reconnectTimeoutId = undefined;
		}
		// Prevent future auto-reconnects after manual disconnect
		this.options.autoReconnect = false;

		// Send a disconnect message if authenticated and connected
		if (this.authenticated && this.connection) {
			try {
		// console.log('[ShellClient.disconnect] Sending DISCONNECT message to server.');
				await this.sendMessage({
					id: crypto.randomUUID(),
					type: MessageType.DISCONNECT,
					timestamp: Date.now(),
					payload: {
						reason: 'Client disconnected',
					},
				});
			} catch (error){
		console.warn('[ShellClient.disconnect] Error sending disconnect message (proceeding with local disconnect):', error);
				// Ignore errors during disconnect message, still perform local cleanup
			}
		}

		// console.log('[ShellClient.disconnect] Performing local disconnect cleanup.');
		// Trigger the local disconnection process
		this.handleDisconnect('Client disconnected');
	}

	/**
	 * Register an event handler
	 */
	public on(event: ClientEvent, handler: (payload: unknown) => void): void {
		this.eventEmitter.on(event, handler);
	}

	/**
	 * Unregister an event handler
	 */
	public off(event: ClientEvent, handler: (payload: unknown) => void): void {
		this.eventEmitter.off(event, handler);
	}

	/**
	 * Emit an event
	 */
	private emitEvent(event: ClientEvent, payload: unknown): void {
	// // console.log(`[ShellClient.emitEvent] Emitting event: ${event}`, payload); // Log event and payload - can be very verbose
		this.eventEmitter.emit(event, payload);
	}

	/**
	 * Reads data from the input stream (written by the client app) and sends it to the server via sendInput.
	 * This runs continuously after connection.
	 */
	private async processInputStream(): Promise<void> {
		// console.log('[ShellClient.processInputStream] Starting input stream processing loop.');
		try {
			while (this.connected) {
				// Read data written to the client's internal input stream
				const { value, done } = await this.inputReader.read();
				if (done) {
					// console.log('[ShellClient.processInputStream] Input stream closed by writer.');
					// Optional: Signal end-of-input to server if protocol supports it
					// await this.sendInput('<EOF>'); // Example, depends on server handling
					break;
				}
				if (value && typeof value === 'string' && value.length > 0) {
					// Send the read data to the server as an INPUT message
					await this.sendInput(value);
				} else if (value) {
					// Handle non-string or empty values if necessary
					console.warn('[ShellClient.processInputStream] Received non-string or empty value from input stream:', value);
				}
			}
		} catch (error) {
			console.error('[ShellClient.processInputStream] Error reading from input stream:', error);
			if (this.connected) {
				// Propagate error only if still connected
				this.handleConnectionError(error);
			}
		} finally {
			// console.log('[ShellClient.processInputStream] Exiting input stream processing loop.');
			// Ensure the reader lock is released if the loop exits unexpectedly
			// It's often better to let the stream manage its own state, but
			// explicitly releasing might be needed in some error scenarios.
			// try { this.inputReader.releaseLock(); } catch { /* ignore */ }
		}
	}
}
