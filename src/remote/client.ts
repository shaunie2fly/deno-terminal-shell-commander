/**
 * Remote Shell Client Implementation
 *
 * Provides a client for connecting to remote shell instances
 * @module
 */

import { EventEmitter } from 'node:events';
import { AuthCredentials, AuthType, ClientEvent, MessageType, ProtocolMessage, ProtocolMessageRT } from './protocol.ts'; // Added InputMessage

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
 * Provides a client for connecting to and interacting with a remote shell server.
 *
 * This class manages the connection (TCP or Unix socket), authentication,
 * message passing, and input/output streams for a remote shell session.
 * It supports automatic reconnection and emits events for connection status,
 * output, and errors.
 *
 * @example
 * ```typescript
 * const client = new ShellClient({ port: 8080, auth: { username: 'user', password: 'pw' } });
 *
 * client.on(ClientEvent.CONNECT, () => console.log('Connected!'));
 * client.on(ClientEvent.DISCONNECT, ({ reason }) => console.log(`Disconnected: ${reason}`));
 * client.on(ClientEvent.OUTPUT, ({ content }) => process.stdout.write(content)); // Pipe server output to local stdout
 * client.on(ClientEvent.ERROR, ({ message, error }) => console.error(`Client Error: ${message}`, error));
 *
 * await client.connect();
 *
 * // Get streams for interaction
 * const writer = client.getInputStream().getWriter();
 * // const reader = client.getOutputStream().getReader(); // Already handled by OUTPUT event above
 *
 * // Send input to the remote shell
 * await writer.write('ls -la\n');
 *
 * // ... later
 * await client.disconnect();
 * ```
 *
 * @emits {@link ClientEvent.CONNECT} - When the connection is established and authenticated.
 * @emits {@link ClientEvent.DISCONNECT} - When the connection is lost or closed.
 * @emits {@link ClientEvent.OUTPUT} - When output data is received from the server.
 * @emits {@link ClientEvent.ERROR} - When a client-side or server-reported error occurs.
 */
export class ShellClient {
	/** @internal Configuration options passed during instantiation. */
	private options: ShellClientOptions;
	/** @internal Emitter for handling client events (connect, disconnect, output, error). */
	private eventEmitter = new EventEmitter();
	/** @internal The underlying Deno connection object (TCP or Unix socket). */
	private connection?: Deno.Conn;
	/** @internal Flag indicating if the client is currently connected. */
	private connected = false;
	/** @internal Flag indicating if the client has successfully authenticated. */
	private authenticated = false;
	/** @internal The session ID assigned by the server after successful authentication. */
	private sessionId?: string;
	/** @internal Counter for automatic reconnection attempts. */
	private reconnectAttempts = 0;
	/** @internal Timeout ID for the scheduled reconnection attempt. */
	private reconnectTimeoutId?: number;
	/** @internal Transform stream where server output is written before being read by the client application. */
	private outputStream: TransformStream<string, string>;
	/** @internal Writer for the `outputStream`. */
	private outputWriter: WritableStreamDefaultWriter<string>;
	/** @internal Transform stream where the client application writes input before it's processed and sent to the server. */
	private inputStream: TransformStream<string, string>;
	/** @internal Reader for the `inputStream`. */
	private inputReader: ReadableStreamDefaultReader<string>;
	/**
	 * @internal Map storing promises for requests awaiting a specific response (e.g., authentication).
	 * Keyed by the request message ID. Used for request/response correlation.
	 */
	private pendingCommands = new Map<string, {
		resolve: (value: unknown) => void;
		reject: (reason: unknown) => void;
	}>();

	/**
	 * Creates an instance of the ShellClient.
	 *
	 * Initializes the client with provided options, setting defaults for missing
	 * optional parameters and preparing the input/output streams.
	 *
	 * @param options - Configuration options for the client connection and behavior.
	 * @see {@link ShellClientOptions} for detailed options.
	 */
	constructor(options: ShellClientOptions) {
		console.log('[ShellClient] Creating instance with options:', options);
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
		console.log('[ShellClient] Instance created and streams initialized.');
	}

	/**
	 * Establishes a connection to the remote shell server based on the configured options.
	 *
	 * This method handles selecting the connection type (TCP or Unix socket),
	 * establishing the connection, starting message processing loops for both
	 * incoming server messages and outgoing client input, and initiating authentication
	 * if credentials are provided.
	 *
	 * It manages the connection state and resets reconnection attempts upon successful connection.
	 * If authentication is required, it calls the `authenticate` method. If not, it sets
	 * the client to authenticated and emits the `CONNECT` event immediately after connection.
	 *
	 * Connection errors during this process are handled by `handleConnectionError`,
	 * which may trigger the reconnection logic if enabled.
	 *
	 * @returns A Promise that resolves when the connection is successfully established
	 *          and (if required) authenticated. It rejects if the initial connection
	 *          or authentication fails and auto-reconnect is disabled or exhausted.
	 * @throws {Error} If invalid connection options are provided (e.g., missing port for TCP).
	 * @emits {@link ClientEvent.CONNECT} upon successful connection and authentication.
	 * @emits {@link ClientEvent.ERROR} if connection or authentication fails.
	 */
	public async connect(): Promise<void> {
		if (this.connected) {
			console.log('[ShellClient.connect] Already connected.');
			return;
		}

		console.log('[ShellClient.connect] Attempting connection...');
		try {
			// Establish connection based on the connection type
			if (this.options.connectionType === 'unix' && this.options.socketPath) {
				await this.connectUnixSocket();
			} else if (this.options.port) { // Default to TCP if port is specified
				await this.connectTcp();
			} else {
				console.error('[ShellClient.connect] Invalid connection options provided.');
				throw new Error('Invalid connection options: must specify port for TCP or socketPath for Unix');
			}

			console.log('[ShellClient.connect] Connection established.');
			this.connected = true;
			this.reconnectAttempts = 0;

			// Start message processing loop (receives messages from server)
			this.processMessages().catch(this.handleConnectionError.bind(this));

			// Authenticate if needed
			if (this.options.auth) {
				await this.authenticate(); // This emits CONNECT event on success
			} else {
				console.log('[ShellClient.connect] No authentication required. Emitting CONNECT event.');
				// No authentication needed
				this.authenticated = true;
				this.emitEvent(ClientEvent.CONNECT, { authenticated: true });
			}

			// --- Start Input Stream Processing ---
			// After connection and potential authentication, start reading from the input stream
			// and sending data to the server.
			this.processInputStream().catch((err: unknown) => { // Add type to err
				console.error('[ShellClient] Error processing input stream:', err);
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
	 * Connects to the server using a Unix domain socket.
	 * @internal
	 * @throws {Error} If the connection to the specified socket path fails.
	 */
	private async connectUnixSocket(): Promise<void> {
		console.log('[ShellClient.connectUnixSocket] Attempting connection...');
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
	 * Connects to the server using TCP.
	 * @internal
	 * @throws {Error} If the connection to the specified host and port fails.
	 */
	private async connectTcp(): Promise<void> {
		console.log('[ShellClient.connectTcp] Attempting connection...');
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
	 * Performs authentication with the remote server using the credentials provided in options.
	 *
	 * This method constructs an `AUTH_REQUEST` message based on the available credentials
	 * (token or username/password) and sends it to the server using `sendAndWaitForResponse`,
	 * expecting an `AUTH_RESPONSE`.
	 *
	 * On successful authentication (indicated by `success: true` in the response payload),
	 * it sets the `authenticated` flag to true, stores the received `sessionId`, and emits
	 * the `CONNECT` event with authentication details.
	 *
	 * If authentication fails (either the server rejects it or an unexpected response is received),
	 * an error is thrown, the `authenticated` flag is set to false, and the error propagates
	 * up (likely caught by the `connect` method to trigger `handleConnectionError`).
	 *
	 * @internal
	 * @returns A Promise that resolves when authentication is successful.
	 * @throws {Error} If authentication fails (server rejection, timeout, or unexpected response).
	 * @emits {@link ClientEvent.CONNECT} upon successful authentication.
	 */
	private async authenticate(): Promise<void> {
		console.log('[ShellClient.authenticate] Starting authentication...');
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

		// Send authentication request
		try {
			const response = await this.sendAndWaitForResponse(authRequest, MessageType.AUTH_RESPONSE);

			// Type guard to ensure we have an AuthResponseMessage
			if (response.type === MessageType.AUTH_RESPONSE) {
				if (response.payload.success) {
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
	 * Determines the appropriate {@link AuthType} based on the credentials provided in the options.
	 *
	 * It prioritizes token authentication if a token is present, falls back to basic
	 * (username/password) authentication if both are present, and defaults to `NONE` otherwise.
	 *
	 * @internal
	 * @returns The determined {@link AuthType}.
	 */
	private getAuthType(): AuthType {
		console.log('[ShellClient.getAuthType] Determining authentication type...');
		if (this.options.auth?.token) {
			console.log('[ShellClient.getAuthType] Using TOKEN authentication.');
			return AuthType.TOKEN;
		} else if (this.options.auth?.username && this.options.auth?.password) {
			console.log('[ShellClient.getAuthType] Using BASIC authentication.');
			return AuthType.BASIC;
		} else {
			console.log('[ShellClient.getAuthType] Using NONE authentication.');
			return AuthType.NONE;
		}
	}

	/**
	 * Continuously reads data from the server connection, decodes it, splits it into lines,
	 * and passes each line to `handleMessage` for processing.
	 *
	 * This method runs as a background loop after the connection is established.
	 * It handles partial messages received across multiple read operations and manages
	 * the connection lifecycle based on read results (e.g., `null` indicating peer closure).
	 *
	 * Errors during reading are passed to `handleConnectionError` if the client is still
	 * considered connected.
	 *
	 * @internal
	 * @returns A Promise that resolves when the message processing loop exits (usually on disconnect).
	 */
	private async processMessages(): Promise<void> {
		console.log('[ShellClient.processMessages] Starting message processing loop.');
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
					console.log('[ShellClient.processMessages] Connection closed by peer (read returned null).');
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
				console.log('[ShellClient.processMessages] Ignoring read error on already disconnected client.');
			}
		} finally {
			console.log('[ShellClient.processMessages] Exiting message processing loop.');
		}
	}

	/**
	 * Parses and handles a single, complete message received from the server.
	 *
	 * It attempts to parse the message text as JSON and validates it against the
	 * `ProtocolMessageRT` Runtype schema.
	 *
	 * Based on the validated message `type`, it performs the appropriate action:
	 * - Resolves pending promises for `AUTH_RESPONSE` or `COMMAND_RESPONSE`.
	 * - Writes `OUTPUT` content to the `outputStream` and emits an `OUTPUT` event.
	 * - Emits an `ERROR` event for server-sent `ERROR` messages.
	 * - Handles server-initiated `DISCONNECT` messages by calling `handleDisconnect`.
	 * - Responds to `PING` messages with a `PONG`.
	 * - Ignores `PONG` messages.
	 * - Logs warnings for unexpected message types (client->server messages received from server).
	 *
	 * If parsing or validation fails, or an unhandled message type is encountered,
	 * an `ERROR` event is emitted.
	 *
	 * @internal
	 * @param messageText - The raw string content of a single message line received from the server.
	 * @emits {@link ClientEvent.ERROR} for invalid messages, server errors, or internal handling errors.
	 * @emits {@link ClientEvent.OUTPUT} for `OUTPUT` type messages.
	 */
	private handleMessage(messageText: string): void {
		try {
			const message = JSON.parse(messageText);
			// Use Runtypes for robust validation
			const validationResult = ProtocolMessageRT.validate(message);

			if (!validationResult.success) {
				this.emitEvent(ClientEvent.ERROR, {
					message: 'Invalid message format',
					details: validationResult.message,
				});
				return;
			}

			const validatedMessage = validationResult.value; // Use validated message

			// Process based on message type
			switch (validatedMessage.type) {
				case MessageType.AUTH_RESPONSE:
					console.log('[ShellClient.handleMessage] Resolving promise for AUTH_RESPONSE.');
					this.resolvePromise(validatedMessage);
					break;

				case MessageType.COMMAND_RESPONSE: // Keep for potential non-shell commands
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
					console.error(
						`[ShellClient.handleMessage] Received ERROR message from server: ${validatedMessage.payload.message} (Code: ${validatedMessage.payload.code})`,
					);
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
						console.error('[ShellClient.handleMessage] Mismatched type in DISCONNECT case.');
					}
					break;

				case MessageType.PING:
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

				// Add cases for types sent *by* the client, which shouldn't be received *from* the server.
				case MessageType.AUTH_REQUEST:
				case MessageType.COMMAND_REQUEST: // Also deprecated
				case MessageType.INPUT:
				case MessageType.RESIZE:
					console.warn(`[ShellClient.handleMessage] Received unexpected message type from server (should be client->server only): ${validatedMessage.type}. Ignoring.`);
					break;
				default: {
					// This is now truly unreachable if the switch handles all members of MessageType enum
					// that are part of the ProtocolMessage union validated by ProtocolMessageRT.
					const unhandled: never = validatedMessage; // This should now type-check correctly.
					console.error(`[ShellClient.handleMessage] FATAL: Unhandled validated message type reached default case. This indicates a bug. Type: ${(unhandled as ProtocolMessage).type}`);
					this.emitEvent(ClientEvent.ERROR, {
						message: 'Internal error: Unhandled message type',
						rawMessageStart: messageText.substring(0, 100),
					});
					break;
				}
			} // End switch
		} catch (error) {
			console.error('[ShellClient.handleMessage] Error parsing or handling message:', error, 'Original text:', messageText);
			this.emitEvent(ClientEvent.ERROR, {
				message: 'Error processing message',
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	/**
	 * Resolves or rejects a pending promise stored in `pendingCommands` when a corresponding
	 * response message is received.
	 *
	 * It looks up the promise using the `id` from the received `message`. If found,
	 * it calls the stored `resolve` function with the message and removes the entry
	 * from the map. If no pending request matches the ID (e.g., due to timeout or
	 * unsolicited response), it logs a warning.
	 *
	 * @internal
	 * @param message - The validated response message received from the server.
	 */
	private resolvePromise(message: ProtocolMessage): void {
		const requestId = message.id; // Use the ID from the response which should match original request
		const pendingRequest = this.pendingCommands.get(requestId);

		if (pendingRequest) {
			pendingRequest.resolve(message); // Resolve with the full validated message
			this.pendingCommands.delete(requestId);
		} else {
			// This might happen if a response arrives after a timeout, or it's an unsolicited response
			console.warn(`[ShellClient.resolvePromise] No pending request found for message ID: ${requestId}. Might be a duplicate or late response.`);
		}
	}

	/**
	 * Sends a message to the server and returns a Promise that resolves with the
	 * corresponding response message of a specific type, or rejects on timeout or error.
	 *
	 * This is used for request/response pairs like authentication where the client needs
	 * to wait for a specific server reply.
	 *
	 * It works by:
	 * 1. Storing the `resolve` and `reject` functions of a new Promise in the `pendingCommands` map, keyed by the outgoing message's ID.
	 * 2. Setting a timeout that rejects the promise and cleans up the map entry if the response doesn't arrive in time.
	 * 3. Calling `sendMessage` to send the actual request.
	 *
	 * When `handleMessage` receives a response, it calls `resolvePromise`, which looks up
	 * the pending command by ID. `resolvePromise` then calls the stored `resolve` function here.
	 * This function (`sendAndWaitForResponse`'s promise resolve callback) validates if the received
	 * response type matches `expectedResponseType` before finally resolving the original Promise.
	 *
	 * @internal
	 * @param message - The {@link ProtocolMessage} request to send.
	 * @param expectedResponseType - The {@link MessageType} expected in the response.
	 * @param timeout - Timeout duration in milliseconds (defaults to 30000).
	 * @returns A Promise that resolves with the validated response {@link ProtocolMessage} or rejects with an Error on timeout, send failure, or unexpected response type.
	 */
	private sendAndWaitForResponse(message: ProtocolMessage, expectedResponseType: MessageType, timeout = 30000): Promise<ProtocolMessage> {
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
						console.error(
							`[ShellClient.sendAndWait] Unexpected response type for ID ${message.id}. Expected ${expectedResponseType}, got ${validatedResponse.type}.`,
						);
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
	 * Sends a {@link ProtocolMessage} to the server over the established connection.
	 *
	 * This method handles JSON stringification, UTF-8 encoding, and appending the
	 * required newline character for message delimitation.
	 *
	 * It performs checks to ensure the client is connected before attempting to write.
	 * Write errors are caught, logged, and passed to `handleConnectionError` to manage
	 * potential disconnections or trigger reconnection logic.
	 *
	 * This is generally a "fire-and-forget" method for messages that don't require
	 * a direct correlated response (like `INPUT`, `PONG`, `DISCONNECT`). For requests
	 * needing a response, use `sendAndWaitForResponse`.
	 *
	 * @internal
	 * @param message - The {@link ProtocolMessage} to send.
	 * @returns A Promise that resolves when the message is successfully written to the connection buffer, or rejects if the client is not connected or a write error occurs.
	 * @throws {Error} If the client is not connected. Re-throws write errors after handling them.
	 */
	private async sendMessage(message: ProtocolMessage): Promise<void> {
		
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
	 * Sends input data (e.g., user keystrokes) to the remote shell session.
	 *
	 * This method constructs an `INPUT` {@link ProtocolMessage} containing the provided data
	 * and the current `sessionId`, then sends it using `sendMessage`.
	 *
	 * It checks for connection and authentication status before sending.
	 *
	 * Note: Data sent via this method should typically correspond to user input intended
	 * for the remote shell process (e.g., typing commands, responding to prompts).
	 * For programmatic commands, consider if a different message type or mechanism is more appropriate.
	 *
	 * @param data - The string data to send as input to the remote shell.
	 * @returns A Promise that resolves when the input message is successfully sent, or rejects on connection/authentication errors or send failures.
	 * @throws {Error} If the client is not connected or not authenticated.
	 */
	public async sendInput(data: string): Promise<void> {
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

	// Removed executeCommand method as it's replaced by input/output streams (handled via sendInput and OUTPUT messages)

	/**
	 * Retrieves the readable side of the output stream (`ReadableStream<string>`).
	 *
	 * The client application should read from this stream to receive output data sent
	 * by the remote shell server (originated from `OUTPUT` type {@link ProtocolMessage}s).
	 *
	 * Alternatively, applications can listen for the `ClientEvent.OUTPUT` event which provides
	 * the same data along with potential metadata like command ID and final status.
	 * Using the stream might be preferable for direct piping or more complex stream processing.
	 *
	 * Data is written to this stream internally by the `handleMessage` method.
	 *
	 * @returns The `ReadableStream<string>` from which server output can be read.
	 * @example
	 * ```typescript
	 * const reader = client.getOutputStream().getReader();
	 * while (true) {
	 *   const { done, value } = await reader.read();
	 *   if (done) break;
	 *   process.stdout.write(value); // Display server output
	 * }
	 * ```
	 */
	public getOutputStream(): ReadableStream<string> {
		return this.outputStream.readable;
	}

	/**
	 * Retrieves the writable side of the input stream (`WritableStream<string>`).
	 *
	 * The client application should write to this stream to send input data (e.g., user commands,
	 * interactive responses) to the remote shell session.
	 *
	 * Data written here is consumed internally by the `processInputStream` method, which reads
	 * the data, packages it into `INPUT` type {@link ProtocolMessage}s, and sends it to the
	 * server using the `sendInput` method.
	 *
	 * @returns The `WritableStream<string>` to which client input should be written.
	 * @example
	 * ```typescript
	 * const writer = client.getInputStream().getWriter();
	 * await writer.write('echo "Hello from client!"\n');
	 * await writer.close(); // Or keep writing more input
	 * ```
	 */
	public getInputStream(): WritableStream<string> {
		return this.inputStream.writable;
	}

	/**
	 * Centralized handler for connection-related errors (e.g., read/write failures,
	 * connection refused, authentication errors propagated up).
	 *
	 * It logs the error, emits a `ClientEvent.ERROR` event, and triggers the
	 * disconnection process via `handleDisconnect` if the client was still connected.
	 *
	 * @internal
	 * @param error - The error object or value that occurred.
	 * @emits {@link ClientEvent.ERROR} with details about the connection error.
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
	 * Manages the cleanup and state changes associated with a disconnection.
	 *
	 * This method ensures idempotency (won't run twice if already disconnected).
	 * It performs the following actions:
	 * 1. Sets `connected` and `authenticated` flags to false.
	 * 2. Clears the `sessionId`.
	 * 3. Closes the underlying Deno connection (`this.connection`).
	 * 4. Rejects any pending promises in `pendingCommands`.
	 * 5. Closes the `outputStream` writer and aborts the `inputStream` writable side.
	 * 6. Emits the `ClientEvent.DISCONNECT` event with the reason.
	 * 7. If `autoReconnect` is enabled and attempts are remaining, calls `scheduleReconnect`.
	 *
	 * @internal
	 * @param reason - A string describing the reason for disconnection.
	 * @emits {@link ClientEvent.DISCONNECT} with the reason for disconnection.
	 */
	private handleDisconnect(reason: string): void {
		// console.log(`[ShellClient.handleDisconnect] Handling disconnection. Reason: ${reason}`);
		if (!this.connected) {
			 console.log('[ShellClient.handleDisconnect] Already disconnected.'); // Can be verbose
			return;
		}

		this.connected = false;
		this.authenticated = false;
		this.sessionId = undefined;

		// Close the connection if it's still open
		if (this.connection) {
			try {
				console.log('[ShellClient.handleDisconnect] Closing underlying connection.');
				this.connection.close();
			} catch {
				// Ignore errors during close
				console.warn('[ShellClient.handleDisconnect] Error ignored during connection close.');
			}
			this.connection = undefined;
		}

		// Reject all pending commands/requests
		for (const [_id, { reject }] of this.pendingCommands) {
			reject(new Error('Disconnected from server'));
		}
		this.pendingCommands.clear();

		// Close the streams to signal end to consumers/producers
		// Use try-catch as they might already be closing
		try {
			this.outputWriter.close();
		} catch { /* ignore */ }
		try {
			this.inputStream.writable.abort(reason);
		} catch { /* ignore */ } // Abort writable side

		// Emit disconnect event
		console.log('[ShellClient.handleDisconnect] Emitting DISCONNECT event.');
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
	 * Schedules an attempt to reconnect to the server after a delay.
	 *
	 * This is typically called by `handleDisconnect` when `autoReconnect` is enabled.
	 * It clears any existing reconnect timeout, increments the attempt counter,
	 * and sets a new timeout using `reconnectDelay`.
	 *
	 * The timeout callback attempts to call `connect()`. If `connect()` succeeds,
	 * it resets the `reconnectAttempts` counter. If it fails, `connect()` itself
	 * calls `handleConnectionError` which might lead back here if more attempts
	 * are allowed.
	 *
	 * @internal
	 */
	private scheduleReconnect(): void {
		// console.log(`[ShellClient.scheduleReconnect] Scheduling reconnection attempt ${this.reconnectAttempts + 1}...`);
		if (this.reconnectTimeoutId) {
			console.log('[ShellClient.scheduleReconnect] Clearing existing reconnect timeout.');
			clearTimeout(this.reconnectTimeoutId);
		}

		this.reconnectAttempts++;
		const delay = this.options.reconnectDelay || 5000;
		// console.log(`[ShellClient.scheduleReconnect] Attempt ${this.reconnectAttempts}/${this.options.maxReconnectAttempts || 5} scheduled in ${delay}ms.`);

		this.reconnectTimeoutId = setTimeout(async () => {
			this.reconnectTimeoutId = undefined; // Clear ID before attempting
			try {
				await this.connect();
				// If connect succeeds, reconnectAttempts is reset inside connect()

			} catch (err) { // Catch error from connect()
				console.error(`[ShellClient.scheduleReconnect] Reconnection attempt ${this.reconnectAttempts} failed:`, err instanceof Error ? err.message : err);
				// handleConnectionError is called within connect(), which might trigger another scheduleReconnect if attempts remain.
			}
		}, delay);
	}

	/**
	 * Initiates a manual disconnection from the server.
	 *
	 * This method performs the following actions:
	 * 1. Checks if already disconnected; if so, returns immediately.
	 * 2. Cancels any pending reconnection attempts (`reconnectTimeoutId`).
	 * 3. Disables future automatic reconnections (`autoReconnect = false`).
	 * 4. Sends a `DISCONNECT` message to the server (best effort).
	 * 5. Triggers the local cleanup process by calling `handleDisconnect`.
	 *
	 * @returns A Promise that resolves once the disconnection process is initiated locally. Note that it doesn't wait for server acknowledgment.
	 */
	public async disconnect(): Promise<void> {
		console.log('[ShellClient.disconnect] Manual disconnect initiated.');
		if (!this.connected) {
			console.log('[ShellClient.disconnect] Already disconnected.');
			return;
		}

		// Cancel any pending reconnection attempts
		if (this.reconnectTimeoutId) {
			console.log('[ShellClient.disconnect] Cancelling scheduled reconnect.');
			clearTimeout(this.reconnectTimeoutId);
			this.reconnectTimeoutId = undefined;
		}
		// Prevent future auto-reconnects after manual disconnect
		this.options.autoReconnect = false;

		// Send a disconnect message if authenticated and connected
		if (this.authenticated && this.connection) {
			try {
				console.log('[ShellClient.disconnect] Sending DISCONNECT message to server.');
				await this.sendMessage({
					id: crypto.randomUUID(),
					type: MessageType.DISCONNECT,
					timestamp: Date.now(),
					payload: {
						reason: 'Client disconnected',
					},
				});
			} catch (error) {
				 console.warn('[ShellClient.disconnect] Error sending disconnect message (proceeding with local disconnect):', error);
				// Ignore errors during disconnect message, still perform local cleanup
			}
		}

		console.log('[ShellClient.disconnect] Performing local disconnect cleanup.');
		// Trigger the local disconnection process
		this.handleDisconnect('Client disconnected');
	}

	/**
	 * Registers an event handler for a specific client event.
	 *
	 * Uses the internal `EventEmitter` to manage listeners.
	 *
	 * @param event - The {@link ClientEvent} to listen for.
	 * @param handler - The callback function to execute when the event is emitted. The function will receive the event payload as an argument.
	 * @example
	 * ```typescript
	 * client.on(ClientEvent.CONNECT, () => { console.log('Client connected!'); });
	 * client.on(ClientEvent.OUTPUT, (payload) => { console.log('Received output:', payload.content); });
	 * ```
	 */
	public on(event: ClientEvent, handler: (payload: unknown) => void): void {
		this.eventEmitter.on(event, handler);
	}

	/**
	 * Unregisters a previously registered event handler for a specific client event.
	 *
	 * @param event - The {@link ClientEvent} to stop listening to.
	 * @param handler - The specific callback function to remove. Must be the same function reference used in `on`.
	 */
	public off(event: ClientEvent, handler: (payload: unknown) => void): void {
		this.eventEmitter.off(event, handler);
	}

	/**
	 * Emits a client event with an optional payload.
	 *
	 * Used internally to trigger events like CONNECT, DISCONNECT, OUTPUT, and ERROR.
	 *
	 * @internal
	 * @param event - The {@link ClientEvent} to emit.
	 * @param payload - The data payload associated with the event.
	 */
	private emitEvent(event: ClientEvent, payload: unknown): void {
		this.eventEmitter.emit(event, payload);
	}

	/**
	 * Gets the current connection status of the client.
	 *
	 * @returns `true` if the client is currently connected to the server, `false` otherwise.
	 */
	public get isConnected(): boolean {
		return this.connected;
	}

	/**
	 * Continuously reads data written to the client's `inputStream` (typically by the application)
	 * and sends it to the server using the `sendInput` method.
	 *
	 * This method runs as a background loop after the connection is established and authenticated.
	 * It reads chunks of string data from the `inputReader`, and for each non-empty chunk,
	 * it calls `sendInput` to forward the data to the server as an `INPUT` message.
	 *
	 * The loop terminates if the input stream's writer closes (`read()` returns `done: true`)
	 * or if a connection error occurs. Errors during reading are passed to `handleConnectionError`
	 * if the client is still considered connected.
	 *
	 * @internal
	 * @returns A Promise that resolves when the input processing loop exits.
	 */
	private async processInputStream(): Promise<void> {
		console.log('[ShellClient.processInputStream] Starting input stream processing loop.');
		try {
			while (this.connected) {
				// Read data written to the client's internal input stream
				const { value, done } = await this.inputReader.read();
				if (done) {
					console.log('[ShellClient.processInputStream] Input stream closed by writer.');
					// Optional: Signal end-of-input to server if protocol supports it
					// await this.sendInput('<EOF>'); // Example, depends on server handling
					break;
				}
				if (value && typeof value === 'string' && value.length > 0) {
					// Send the read data to the server as an INPUT message
					await this.sendInput(value);
				} else if (value) {
					// Handle non-string or empty values if necessary
					// console.warn('[ShellClient.processInputStream] Received non-string or empty value from input stream:', value);
				}
			}
		} catch (error) {
			console.error('[ShellClient.processInputStream] Error reading from input stream:', error);
			if (this.connected) {
				// Propagate error only if still connected
				this.handleConnectionError(error);
			}
		} finally {
			console.log('[ShellClient.processInputStream] Exiting input stream processing loop.');
			// Ensure the reader lock is released if the loop exits unexpectedly
			// It's often better to let the stream manage its own state, but
			// explicitly releasing might be needed in some error scenarios.
			// try { this.inputReader.releaseLock(); } catch { /* ignore */ }
		}
	}
}
