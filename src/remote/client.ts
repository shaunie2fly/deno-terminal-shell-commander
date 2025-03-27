/**
 * Remote Shell Client Implementation
 *
 * Provides a client for connecting to remote shell instances
 * @module
 */

import { EventEmitter } from '@std/events';
import { AuthCredentials, AuthType, ClientEvent, MessageType, ProtocolMessage, ProtocolMessageRT } from './protocol.ts';

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
	connectionType?: 'tcp' | 'websocket' | 'unix';
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
	private connection?: Deno.Conn | WebSocket;
	private connected = false;
	private authenticated = false;
	private sessionId?: string;
	private reconnectAttempts = 0;
	private reconnectTimeoutId?: number;
	private outputStream: TransformStream<string, string>;
	private outputWriter: WritableStreamDefaultWriter<string>;
	private inputStream: TransformStream<string, string>;
	private inputReader: ReadableStreamDefaultReader<string>;
	private pendingCommands = new Map<string, {
		resolve: (value: unknown) => void;
		reject: (reason: unknown) => void;
	}>();

	/**
	 * Create a new shell client
	 * @param options - Configuration options for the client
	 */
	constructor(options: ShellClientOptions) {
		// Set defaults for optional parameters
		this.options = {
			...options,
			host: options.host || 'localhost',
			connectionType: options.connectionType || 'tcp',
			autoReconnect: options.autoReconnect ?? true,
			reconnectDelay: options.reconnectDelay || 5000,
			maxReconnectAttempts: options.maxReconnectAttempts || 5,
		};

		// Create streams for input and output
		this.outputStream = new TransformStream<string, string>();
		this.outputWriter = this.outputStream.writable.getWriter();

		this.inputStream = new TransformStream<string, string>();
		this.inputReader = this.inputStream.readable.getReader();
	}

	/**
	 * Connect to the remote shell server
	 * @returns Promise that resolves when connected and authenticated
	 */
	public async connect(): Promise<void> {
		if (this.connected) {
			return;
		}

		try {
			// Establish connection based on the connection type
			if (this.options.connectionType === 'websocket') {
				await this.connectWebSocket();
			} else if (this.options.connectionType === 'unix' && this.options.socketPath) {
				await this.connectUnixSocket();
			} else if (this.options.port) {
				await this.connectTcp();
			} else {
				throw new Error('Invalid connection options: must specify port, socketPath, or use WebSocket');
			}

			this.connected = true;
			this.reconnectAttempts = 0;

			// Start message processing
			if (this.options.connectionType === 'websocket') {
				// WebSocket message processing is handled by event handlers
			} else {
				this.processMessages().catch(this.handleConnectionError.bind(this));
			}

			// Authenticate if needed
			if (this.options.auth) {
				await this.authenticate();
			} else {
				// No authentication needed
				this.authenticated = true;
				this.emitEvent(ClientEvent.CONNECT, { authenticated: true });
			}
		} catch (error) {
			this.handleConnectionError(error);
			throw error;
		}
	}

	/**
	 * Connect via WebSocket
	 */
	private connectWebSocket(): Promise<void> {
		const wsUrl = `ws://${this.options.host}:${this.options.port}`;

		try {
			const socket = new WebSocket(wsUrl);

			// Set up event handlers
			socket.onopen = () => {
				this.connected = true;
				// Don't emit connect event until authenticated
			};

			socket.onmessage = (event) => {
				this.handleMessage(event.data.toString());
			};

			socket.onclose = () => {
				this.handleDisconnect('WebSocket closed');
			};

			socket.onerror = (error) => {
				this.handleConnectionError(error);
			};

			this.connection = socket;

			// Wait for the connection to be established
			return new Promise((resolve, reject) => {
				const timeout = setTimeout(() => {
					reject(new Error('WebSocket connection timeout'));
				}, 10000);

				const checkConnection = () => {
					if (socket.readyState === WebSocket.OPEN) {
						clearTimeout(timeout);
						resolve();
					} else if (socket.readyState === WebSocket.CLOSED || socket.readyState === WebSocket.CLOSING) {
						clearTimeout(timeout);
						reject(new Error('WebSocket connection failed'));
					} else {
						setTimeout(checkConnection, 100);
					}
				};

				checkConnection();
			});
		} catch (error) {
			throw new Error(`WebSocket connection failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
	 * Connect via Unix domain socket
	 */
	private async connectUnixSocket(): Promise<void> {
		try {
			const conn = await Deno.connect({
				path: this.options.socketPath!,
				transport: 'unix',
			});
			this.connection = conn;
		} catch (error) {
			throw new Error(`Unix socket connection failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
	 * Connect via TCP
	 */
	private async connectTcp(): Promise<void> {
		try {
			const conn = await Deno.connect({
				hostname: this.options.host,
				port: this.options.port!,
			});
			this.connection = conn;
		} catch (error) {
			throw new Error(`TCP connection failed: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
	 * Authenticate with the server
	 */
	private async authenticate(): Promise<void> {
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

			if (response.payload.success) {
				this.authenticated = true;
				this.sessionId = response.payload.sessionId;
				this.emitEvent(ClientEvent.CONNECT, { authenticated: true, sessionId: this.sessionId });
			} else {
				throw new Error(`Authentication failed: ${response.payload.error || 'Unknown error'}`);
			}
		} catch (error) {
			this.authenticated = false;
			this.handleConnectionError(error);
			throw error;
		}
	}

	/**
	 * Determine the authentication type based on provided credentials
	 */
	private getAuthType(): AuthType {
		if (this.options.auth?.token) {
			return AuthType.TOKEN;
		} else if (this.options.auth?.username && this.options.auth?.password) {
			return AuthType.BASIC;
		} else {
			return AuthType.NONE;
		}
	}

	/**
	 * Process incoming messages from the server
	 */
	private async processMessages(): Promise<void> {
		if (!this.connection || this.connection instanceof WebSocket) {
			return;
		}

		const conn = this.connection as Deno.Conn;
		const buffer = new Uint8Array(4096);
		let leftover = '';

		try {
			while (this.connected) {
				const n = await conn.read(buffer);
				if (n === null) {
					this.handleDisconnect('End of stream');
					break;
				}

				const chunk = new TextDecoder().decode(buffer.subarray(0, n));
				const lines = (leftover + chunk).split('\n');
				leftover = lines.pop() || '';

				for (const line of lines) {
					if (line.trim()) {
						this.handleMessage(line);
					}
				}
			}
		} catch (error) {
			this.handleConnectionError(error);
		}
	}

	/**
	 * Handle an incoming message
	 */
	private handleMessage(messageText: string): void {
		try {
			const message = JSON.parse(messageText);
			const validationResult = ProtocolMessageRT.validate(message);

			if (!validationResult.success) {
				this.emitEvent(ClientEvent.ERROR, {
					message: 'Invalid message format',
					details: validationResult.message,
				});
				return;
			}

			// Process based on message type
			switch (message.type) {
				case MessageType.AUTH_RESPONSE:
					// Handle by the waiting promise in authenticate()
					this.resolvePromise(message);
					break;

				case MessageType.COMMAND_RESPONSE:
					// Resolve the promise for the corresponding command
					this.resolvePromise(message);
					break;

				case MessageType.OUTPUT:
					// Write to the output stream
					this.outputWriter.write(message.payload.content).catch((error) => {
						this.emitEvent(ClientEvent.ERROR, {
							message: 'Failed to write to output stream',
							error,
						});
					});

					// Also emit an output event
					this.emitEvent(ClientEvent.OUTPUT, {
						content: message.payload.content,
						commandId: message.payload.commandId,
						final: message.payload.final,
					});
					break;

				case MessageType.ERROR:
					// Emit error event
					this.emitEvent(ClientEvent.ERROR, {
						message: message.payload.message,
						code: message.payload.code,
					});
					break;

				case MessageType.DISCONNECT:
					// Handle server-initiated disconnect
					this.handleDisconnect(message.payload.reason);
					break;

				case MessageType.PING:
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
					// Nothing to do for pong response
					break;

				default:
					this.emitEvent(ClientEvent.ERROR, {
						message: `Unhandled message type: ${message.type}`,
					});
					break;
			}
		} catch (error) {
			this.emitEvent(ClientEvent.ERROR, {
				message: 'Error processing message',
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}

	/**
	 * Resolve a pending promise for a message response
	 */
	private resolvePromise(message: ProtocolMessage): void {
		const requestId = message.id;
		const pendingRequest = this.pendingCommands.get(requestId);

		if (pendingRequest) {
			pendingRequest.resolve(message);
			this.pendingCommands.delete(requestId);
		}
	}

	/**
	 * Send a message to the server and wait for a response
	 * @param message - The message to send
	 * @param expectedResponseType - The expected response message type
	 * @param timeout - Timeout in milliseconds (defaults to 30000)
	 * @returns Promise that resolves with the response message
	 */
	private sendAndWaitForResponse(message: ProtocolMessage,expectedResponseType: MessageType,timeout = 30000,): Promise<any> {
		return new Promise((resolve, reject) => {
			// Set up timeout
			const timeoutId = setTimeout(() => {
				this.pendingCommands.delete(message.id);
				reject(new Error(`Timeout waiting for ${expectedResponseType} response`));
			}, timeout);

			// Store the promise resolvers
			this.pendingCommands.set(message.id, {
				resolve: (response) => {
					clearTimeout(timeoutId);
					// Validate the response is a ProtocolMessage
					const validationResult = ProtocolMessageRT.validate(response);
					if (!validationResult.success) {
						reject(new Error(`Invalid response format: ${validationResult.message}`));
						return;
					}
					
					if (validationResult.value.type !== expectedResponseType) {
						reject(new Error(`Expected ${expectedResponseType}, got ${validationResult.value.type}`));
					} else {
						resolve(validationResult.value);
					}
				},
				reject: (error) => {
					clearTimeout(timeoutId);
					reject(error);
				},
			});

			// Send the message
			this.sendMessage(message).catch((error) => {
				clearTimeout(timeoutId);
				this.pendingCommands.delete(message.id);
				reject(error);
			});
		});
	}

	/**
	 * Send a message to the server
	 * @param message - The message to send
	 */
	private async sendMessage(message: ProtocolMessage): Promise<void> {
		if (!this.connected || !this.connection) {
			throw new Error('Not connected to server');
		}

		if (this.connection instanceof WebSocket) {
			if (this.connection.readyState !== WebSocket.OPEN) {
				throw new Error('WebSocket not open');
			}
			this.connection.send(JSON.stringify(message));
		} else {
			const conn = this.connection as Deno.Conn;
			const data = new TextEncoder().encode(JSON.stringify(message) + '\n');
			await conn.write(data);
		}
	}

	/**
	 * Execute a command on the remote shell
	 * @param command - The command to execute
	 * @returns Promise that resolves with the command result
	 */
	public async executeCommand(command: string): Promise<{
		success: boolean;
		output?: string;
		error?: string;
	}> {
		if (!this.connected) {
			throw new Error('Not connected to server');
		}

		if (!this.authenticated) {
			throw new Error('Not authenticated');
		}

		const commandRequest: ProtocolMessage = {
			id: crypto.randomUUID(),
			type: MessageType.COMMAND_REQUEST,
			timestamp: Date.now(),
			payload: {
				command,
				sessionId: this.sessionId!,
			},
		};

		try {
			const response = await this.sendAndWaitForResponse(
				commandRequest,
				MessageType.COMMAND_RESPONSE,
			);

			return {
				success: response.payload.success,
				output: response.payload.output,
				error: response.payload.error,
			};
		} catch (error) {
			this.emitEvent(ClientEvent.ERROR, {
				message: 'Error executing command',
				error: error instanceof Error ? error.message : String(error),
				command,
			});
			throw error;
		}
	}

	/**
	 * Get the output stream for shell output
	 * @returns ReadableStream of output content
	 */
	public getOutputStream(): ReadableStream<string> {
		return this.outputStream.readable;
	}

	/**
	 * Get the input stream for sending input to the shell
	 * @returns WritableStream for input
	 */
	public getInputStream(): WritableStream<string> {
		return this.inputStream.writable;
	}

	/**
	 * Handle a connection error
	 */
	private handleConnectionError(error: unknown): void {
		this.emitEvent(ClientEvent.ERROR, {
			message: 'Connection error',
			error: error instanceof Error ? error.message : String(error),
		});

		this.handleDisconnect('Connection error');
	}

	/**
	 * Handle disconnection from the server
	 */
	private handleDisconnect(reason: string): void {
		if (!this.connected) {
			return;
		}

		this.connected = false;
		this.authenticated = false;
		this.sessionId = undefined;

		// Close the connection if it's still open
		if (this.connection) {
			try {
				if (this.connection instanceof WebSocket) {
					this.connection.close();
				} else {
					(this.connection as Deno.Conn).close();
				}
			} catch {
				// Ignore errors during close
			}
			this.connection = undefined;
		}

		// Reject all pending commands
		for (const [id, { reject }] of this.pendingCommands) {
			reject(new Error('Disconnected from server'));
		}
		this.pendingCommands.clear();

		// Emit disconnect event
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
		if (this.reconnectTimeoutId) {
			clearTimeout(this.reconnectTimeoutId);
		}

		this.reconnectAttempts++;
		const delay = this.options.reconnectDelay || 5000;

		this.reconnectTimeoutId = setTimeout(async () => {
			try {
				await this.connect();
			} catch {
				// Error handling is done in connect()
			}
		}, delay);
	}

	/**
	 * Disconnect from the server
	 */
	public async disconnect(): Promise<void> {
		if (!this.connected) {
			return;
		}

		// Cancel any reconnection attempts
		if (this.reconnectTimeoutId) {
			clearTimeout(this.reconnectTimeoutId);
			this.reconnectTimeoutId = undefined;
		}

		// Send a disconnect message if authenticated
		if (this.authenticated && this.connection) {
			try {
				await this.sendMessage({
					id: crypto.randomUUID(),
					type: MessageType.DISCONNECT,
					timestamp: Date.now(),
					payload: {
						reason: 'Client disconnected',
					},
				});
			} catch {
				// Ignore errors during disconnect message
			}
		}

		// Close the connection
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
		this.eventEmitter.emit(event, payload);
	}
}
