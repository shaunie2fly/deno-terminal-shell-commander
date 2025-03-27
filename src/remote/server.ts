/**
 * Remote Shell Server Implementation
 *
 * Provides a server that exposes shell instances for remote access
 * @module
 */
import { EventEmitter } from 'node:events';
import { Shell } from '../shell/Shell.ts';
import { AuthOptions, AuthType, Connection, InputMessage, MessageType, ProtocolMessage, ProtocolMessageRT, ServerEvent } from './protocol.ts'; // Added InputMessage
import { ShellEventType } from '../shell/types.ts'; // Import ShellEventType

/**
 * Configuration options for the shell server
 */
export interface ShellServerOptions {
	/** The shell instance to expose */
	shell: Shell;
	/** TCP port to listen on (optional) */
	port?: number;
	/** Host address to bind to (defaults to localhost) */
	host?: string;
	/** Unix domain socket path for IPC (optional) */
	socketPath?: string;
	/** Authentication options */
	auth?: AuthOptions;
	/** Ping interval in milliseconds (defaults to 30000) */
	pingInterval?: number;
	/** Maximum number of connections (defaults to 10) */
	maxConnections?: number;
}

/**
 * Server for exposing shell instances over network protocols
 */
export class ShellServer {
	private shell: Shell;
	private options: ShellServerOptions;
	private connections: Map<string, Connection> = new Map();
	private eventEmitter = new EventEmitter();
	private pingIntervalId?: number;
	private server?: Deno.Listener;
	private startTime = Date.now();
	private isRunning = false;

	/**
	 * Create a new shell server
	 * @param options - Configuration options for the server
	 */
	constructor(options: ShellServerOptions) {
		// Validate required options
		console.log('[ShellServer] Initializing with options:', options);
		if (!options.shell) {
			console.error('[ShellServer] Error: Shell instance is required');
			throw new Error('Shell instance is required');
		}

		// Set defaults for optional parameters
		this.options = {
			...options,
			host: options.host || 'localhost',
			auth: options.auth || { type: AuthType.NONE },
			pingInterval: options.pingInterval || 30000,
			maxConnections: options.maxConnections || 10,
		};

		console.log('[ShellServer] Final configuration:', this.options);
		this.shell = options.shell;
	}

	/**
	 * Start the shell server
	 * @returns Promise that resolves when the server is started
	 */
	public async start(): Promise<void> {
		if (this.isRunning) {
			console.warn('[ShellServer] Start called but server is already running.');
			throw new Error('Server is already running');
		}

		console.log('[ShellServer] Starting server...');
		// Record start time for uptime tracking
		this.startTime = Date.now();
		this.isRunning = true;

		try {
			// Setup the server based on configuration
			if (this.options.socketPath) {
				console.log(`[ShellServer] Starting Unix socket server at: ${this.options.socketPath}`);
				await this.startUnixSocketServer();
			} else if (this.options.port) {
				console.log(`[ShellServer] Starting TCP server on: ${this.options.host}:${this.options.port}`);
				await this.startTcpServer();
			} else {
				console.error('[ShellServer] Error: Either port or socketPath must be specified');
				throw new Error('Either port or socketPath must be specified');
			}

			console.log('[ShellServer] Server started successfully.');
			// Start the ping interval to keep connections alive
			this.startPingInterval();

			// --- Listen for Shell Stop Event (for shared shell) ---
			// If the shared shell stops (e.g., via 'exit'), disconnect all clients.
			// Note: This assumes a single shared shell instance.
			// A multi-shell-instance design would need per-connection listeners.
			this.shell.on(ShellEventType.STOP, () => {
				console.log('[ShellServer] Shared shell instance stopped. Disconnecting all clients...');
				this.disconnectAll().catch(err => {
					console.error('[ShellServer] Error during disconnectAll after shell stop:', err);
				});
				// Optionally, consider stopping the server itself if the shell stopping means the server should shut down.
				// this.stop();
			});
			// -------------------------------------------------------

		} catch (error) {
			console.error('[ShellServer] Failed to start server:', error);
			this.isRunning = false;
			throw error;
		}
	}

	/**
	 * Set up a Unix domain socket server
	 */
	private async startUnixSocketServer(): Promise<void> {
		try {
			console.log(`[ShellServer] Attempting to remove existing socket file: ${this.options.socketPath}`);
			// Attempt to remove any existing socket file
			try {
				await Deno.remove(this.options.socketPath!);
				console.log(`[ShellServer] Removed existing socket file: ${this.options.socketPath}`);
			} catch {
				console.log(`[ShellServer] No existing socket file found or removal failed (ignored): ${this.options.socketPath}`);
				// Ignore errors if the file doesn't exist
			}

			console.log(`[ShellServer] Creating Unix domain socket listener at: ${this.options.socketPath}`);
			// Create the Unix domain socket server
			const listener = Deno.listen({
				path: this.options.socketPath!,
				transport: 'unix',
			});

			this.server = listener;
			this.acceptConnections(listener);
			console.log(`[ShellServer] Unix socket server listening at: ${this.options.socketPath}`);
		} catch (error) {
			console.error(`[ShellServer] Failed to start Unix socket server at ${this.options.socketPath}:`, error);
			throw new Error(`Failed to start Unix socket server: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
	 * Set up a TCP server
	 */
	private startTcpServer(): Promise<void> {
		try {
			console.log(`[ShellServer] Creating TCP listener on: ${this.options.host}:${this.options.port}`);
			// Create TCP server
			const listener = Deno.listen({
				port: this.options.port!,
				hostname: this.options.host,
			});

			this.server = listener;
			this.acceptConnections(listener);

			console.log(`[ShellServer] TCP server listening on: ${this.options.host}:${this.options.port}`);
			// TCP server started, return resolved promise
			return Promise.resolve();
		} catch (error) {
			console.error(`[ShellServer] Failed to start TCP server on ${this.options.host}:${this.options.port}:`, error);
			throw new Error(`Failed to start TCP server: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
	 * Accept connections from a listener
	 */
	private async acceptConnections(listener: Deno.Listener): Promise<void> {
		const addr = listener.addr;
		console.log(`[ShellServer] Accepting connections on ${addr.transport}://${'hostname' in addr ? addr.hostname + ':' + addr.port : addr.path}...`);
		for await (const conn of listener) {
			const remoteAddr = conn.remoteAddr;
			const remoteAddrString = `${remoteAddr.transport}://${'hostname' in remoteAddr ? remoteAddr.hostname + ':' + remoteAddr.port : 'unix'}`;
			console.log(`[ShellServer] Incoming connection from: ${remoteAddrString}`);
			// Check if we've reached the maximum number of connections
			if (this.connections.size >= this.options.maxConnections!) {
				console.warn(`[ShellServer] Max connections (${this.options.maxConnections}) reached. Rejecting connection from ${remoteAddrString}.`);
				conn.close();
				continue;
			}

			console.log(`[ShellServer] Accepting connection from: ${remoteAddrString}`);
			// Handle the new connection
			this.handleConnection(conn);
		}
		console.log(`[ShellServer] Stopped accepting connections on ${addr.transport}://${'hostname' in addr ? addr.hostname + ':' + addr.port : addr.path}.`);
	}

	/**
	 * Handle a new TCP connection
	 */
	private async handleConnection(conn: Deno.Conn): Promise<void> {
		const connectionId = crypto.randomUUID();
		const remoteAddr = conn.remoteAddr;
		const remoteAddrString = `${remoteAddr.transport}://${'hostname' in remoteAddr ? remoteAddr.hostname + ':' + remoteAddr.port : 'unix'}`;
		console.log(`[ShellServer][Conn ${connectionId}] Handling new connection from ${remoteAddrString}`);

		let authenticated = this.options.auth?.type === AuthType.NONE;
		let username: string | undefined;

		// Create a connection object to track this connection
		const connection: Connection = {
			id: connectionId,
			username,
			connected: true,
			connectedAt: Date.now(),
			lastActivity: Date.now(),
			send: async (message: ProtocolMessage) => {
				try {
					const data = new TextEncoder().encode(JSON.stringify(message) + '\n');
					await conn.write(data);
				} catch (error) {
					await this.handleConnectionError(connectionId, error);
				}
			},
			disconnect: async (reason: string) => {
				try {
					// Send disconnect message before closing
					await connection.send({
						id: crypto.randomUUID(),
						type: MessageType.DISCONNECT,
						// deno-lint-ignore no-explicit-any
						timestamp: Date.now(),
						payload: { reason },
					});
					console.log(`[ShellServer][Conn ${connectionId}] Sent disconnect message. Reason: ${reason}`);
					conn.close();
				} catch {
					console.warn(`[ShellServer][Conn ${connectionId}] Error sending disconnect message (ignoring).`);
					// Ignore errors during disconnect
				} finally {
					this.connections.delete(connectionId);
					console.log(`[ShellServer][Conn ${connectionId}] Connection closed and removed. Reason: ${reason}`);
					this.emitEvent(ServerEvent.DISCONNECT, { connectionId, reason });
				}
			},
		};

		// Store the connection
		this.connections.set(connectionId, connection);

		console.log(`[ShellServer][Conn ${connectionId}] Connection stored. Total connections: ${this.connections.size}`);
		// Emit connection event
		this.emitEvent(ServerEvent.CONNECT, { connectionId });

		// Handle messages from this connection
		try {
			for await (const chunk of this.readLines(conn)) {
				console.log(`[ShellServer][Conn ${connectionId}] Received chunk: ${chunk.substring(0, 100)}${chunk.length > 100 ? '...' : ''}`);
				// Update last activity time
				connection.lastActivity = Date.now();

				try {
					// Parse and validate the message
					const message = JSON.parse(chunk);
					const validationResult = ProtocolMessageRT.validate(message);

					console.log(`[ShellServer][Conn ${connectionId}] Parsed message type: ${message.type}`);
					if (!validationResult.success) {
						console.warn(`[ShellServer][Conn ${connectionId}] Invalid message format received:`, validationResult.message);
						await connection.send({
							id: crypto.randomUUID(),
							type: MessageType.ERROR,
							// deno-lint-ignore no-explicit-any
							timestamp: Date.now(),
							payload: {
								message: 'Invalid message format',
								code: 'INVALID_MESSAGE',
							},
						});
						continue;
					}

					// Handle the message based on its type
					switch (message.type) {
						case MessageType.AUTH_REQUEST: {
							// Handle authentication request
							console.log(`[ShellServer][Conn ${connectionId}] Processing AUTH_REQUEST`);
							if (authenticated) {
								console.log(`[ShellServer][Conn ${connectionId}] Already authenticated, sending success response.`);
								await connection.send({
									id: message.id, // Use original request ID
									type: MessageType.AUTH_RESPONSE,
									// deno-lint-ignore no-explicit-any
									timestamp: Date.now(),
									payload: {
										success: true,
										sessionId: connectionId,
									},
								});
							} else {
								const authResult = await this.authenticate(message.payload);
								console.log(`[ShellServer][Conn ${connectionId}] Authentication attempt result: ${authResult.success ? 'Success' : 'Failure'}${authResult.error ? ` (${authResult.error})` : ''}`);
								authenticated = authResult.success;
								if (authenticated) {
									username = message.payload.username;
									console.log(`[ShellServer][Conn ${connectionId}] Authentication successful for user: ${username}`);
									connection.username = username;

									// --- Start Shell Instance for this Connection ---
									const sendOutput = (data: string) => {
										// Send shell output back to this specific client
										connection.send({
											id: crypto.randomUUID(), // Unique ID for output message
											type: MessageType.OUTPUT,
											timestamp: Date.now(),
											payload: { content: data, final: false, commandId: 'shell_output' }, // Use a generic ID for shell output
										}).catch(err => console.error(`[ShellServer][Conn ${connectionId}] Error sending output:`, err));
									};

									const processInput = async (command: string) => {
										// Execute the command using the shell instance
										// Pass the context when calling executeCommand on the shell instance itself
										// NOTE: We need to ensure shell.executeCommand eventually gets the context if needed,
										// but the callback here only provides the command string based on Shell refactor.
										// The executeCommand within Shell class will create its own context.
										await this.shell.executeCommand(command);
									};

									// Start the shell instance, providing the callbacks
									await this.shell.start(processInput, sendOutput);
								}
								// Send the authentication response *after* potentially starting the shell
								await connection.send({
									id: message.id, // Use original request ID
									type: MessageType.AUTH_RESPONSE,
									// deno-lint-ignore no-explicit-any
									timestamp: Date.now(),
									payload: {
										success: authResult.success,
										error: authResult.error,
										sessionId: authenticated ? connectionId : undefined,
									},
								});

								if (!authenticated) {
									// Close connection after failed authentication
									console.log(`[ShellServer][Conn ${connectionId}] Authentication failed, disconnecting.`);
									await connection.disconnect('Authentication failed');
								}
							}
							break;
						}
						// Removed the old COMMAND_REQUEST handler block
						case MessageType.PING: {
							// Respond to ping with a pong
							await connection.send({
								// deno-lint-ignore no-explicit-any
								id: crypto.randomUUID(),
								type: MessageType.PONG,
								timestamp: Date.now(),
								payload: {
									uptime: Date.now() - this.startTime,
								},
							});
							break;
						}
						case MessageType.INPUT: {
							// Handle input data from the client
							if (!authenticated) {
								console.warn(`[ShellServer][Conn ${connectionId}] INPUT received but not authenticated. Sending error.`);
								await connection.send({
									id: crypto.randomUUID(), // New error message ID
									type: MessageType.ERROR,
									timestamp: Date.now(),
									payload: { message: 'Not authenticated', code: 'AUTH_REQUIRED' },
								});
								continue; // Don't process further if not authenticated
							}

							// Validate payload structure (basic check)
							const inputMessage = message as InputMessage; // Cast for type safety
							if (typeof inputMessage.payload?.data === 'string') {
								console.log(`[ShellServer][Conn ${connectionId}] Processing INPUT data: ${inputMessage.payload.data.substring(0, 50)}...`);
								// Pass the raw input data (as Uint8Array) to the shell instance
								const inputDataBytes = new TextEncoder().encode(inputMessage.payload.data);
								this.shell.handleInputData(inputDataBytes);
							} else {
								console.warn(`[ShellServer][Conn ${connectionId}] Invalid INPUT message payload:`, inputMessage.payload);
								// Optionally send an error message back
							}
							break;
						}
						case MessageType.PONG: {
							// Typically server doesn't act on PONG, just notes activity
							console.log(`[ShellServer][Conn ${connectionId}] Received PONG.`);
							break;
						}
						default: {
							// Ignore other message types
							// deno-lint-ignore no-explicit-any
							const unhandledType: any = message;
							console.log(`[ShellServer][Conn ${connectionId}] Ignoring unhandled message type: ${unhandledType?.type}`);
							break;
						}
					}
				} catch (_error) {
					console.error(`[ShellServer][Conn ${connectionId}] Error processing message:`, _error);
					// Handle error parsing or processing message
					await connection.send({
						id: crypto.randomUUID(),
						type: MessageType.ERROR,
						// deno-lint-ignore no-explicit-any
						timestamp: Date.now(),
						payload: {
							message: 'Error processing message',
							code: 'PROCESSING_ERROR',
						},
					});
				}
			}
		} catch (error) {
			await this.handleConnectionError(connectionId, error);
			// Error is handled within handleConnectionError, which also logs
		} finally {
			// Clean up the connection if the loop exits
			if (this.connections.has(connectionId)) {
				console.log(`[ShellServer][Conn ${connectionId}] Cleaning up connection due to loop exit/error.`);
				await connection.disconnect('Connection closed');
			}
		}
	}

	/**
	 * Helper method to read messages line by line from a connection
	 */
	private async *readLines(conn: Deno.Conn): AsyncGenerator<string> {
		const buf = new Uint8Array(1024);
		console.log(`[ShellServer][readLines] Starting generator for a connection.`); // Simplified log
		let leftover = '';

		while (true) {
			const n = await conn.read(buf);
			if (n === null) {
				console.log(`[ShellServer][readLines] Read returned null, ending loop.`);
				break;
			}

			// console.log(`[ShellServer][readLines] Read ${n} bytes.`); // Too verbose
			const chunk = new TextDecoder().decode(buf.subarray(0, n));
			const lines = (leftover + chunk).split('\n');
			leftover = lines.pop() || '';

			for (const line of lines) {
				if (line.trim()) {
					yield line;
				}
			}
		}

		// Process any remaining data when the connection closes
		if (leftover.trim()) {
			console.log(`[ShellServer][readLines] Yielding leftover data: ${leftover.substring(0, 100)}${leftover.length > 100 ? '...' : ''}`); // Removed connectionId reference
			yield leftover;
		}
		console.log(`[ShellServer][readLines] Exiting generator.`);
	}

	/**
	 * Authenticate a client based on server authentication settings
	 */
	private async authenticate(payload: {
		authType: AuthType;
		username?: string;
		password?: string;
		token?: string;
		// deno-lint-ignore no-explicit-any
	}): Promise<{ success: boolean; error?: string }> {
		console.log(`[ShellServer] Authenticating connection... AuthType provided: ${payload.authType}`);
		const serverAuthType = this.options.auth?.type || AuthType.NONE;

		// Check if auth types match
		if (payload.authType !== serverAuthType) {
			console.warn(`[ShellServer] Authentication failed: Type mismatch. Server: ${serverAuthType}, Client: ${payload.authType}`);
			return {
				success: false,
				error: `Authentication type mismatch. Server expects ${serverAuthType}, got ${payload.authType}`,
			};
		}

		// No authentication required
		if (serverAuthType === AuthType.NONE) {
			return { success: true };
			console.log(`[ShellServer] Authentication successful (AuthType: NONE).`);
			return { success: true };
		}

		// Basic authentication
		if (serverAuthType === AuthType.BASIC) {
			console.log(`[ShellServer] Attempting Basic authentication for user: ${payload.username}`);
			if (!payload.username || !payload.password) {
				console.warn('[ShellServer] Basic Auth failed: Username or password missing.');
				return {
					success: false,
					error: 'Username and password are required for basic authentication',
				};
			}

			// Check credentials against defined users
			const users = this.options.auth?.users || [];
			for (const user of users) {
				if (user.username === payload.username) {
					console.log(`[ShellServer] Found user: ${user.username}. Verifying password...`);
					// In a real application, you'd use a proper password hashing algorithm
					// and compare the hashed passwords
					const passwordHash = await this.hashPassword(payload.password);
					if (user.passwordHash === passwordHash) {
						console.log(`[ShellServer] Basic Auth successful for user: ${user.username}`);
						return { success: true };
					} else {
						console.warn(`[ShellServer] Basic Auth failed for user ${user.username}: Invalid password.`);
						return { success: false, error: 'Invalid password' };
					}
				}
			}
			console.warn(`[ShellServer] Basic Auth failed: User ${payload.username} not found.`);
			return { success: false, error: 'User not found' };
		}

		// Token authentication
		if (serverAuthType === AuthType.TOKEN) {
			console.log(`[ShellServer] Attempting Token authentication.`);
			if (!payload.token) {
				console.warn('[ShellServer] Token Auth failed: Token missing.');
				return {
					success: false,
					error: 'Token is required for token authentication',
				};
			}

			if (this.options.auth?.tokenValidator) {
				try {
					const isValid = await this.options.auth.tokenValidator(payload.token);
					console.log(`[ShellServer] Token validation result: ${isValid}`);
					return isValid ? { success: true } : { success: false, error: 'Invalid token' };
				} catch (error) {
					console.error('[ShellServer] Token validation error:', error);
					return {
						success: false,
						error: `Token validation error: ${error instanceof Error ? error.message : String(error)}`,
					};
				}
			}
			return { success: false, error: 'No token validator configured' };

		}

		console.error(`[ShellServer] Authentication failed: Unsupported auth type ${serverAuthType}.`);
		return { success: false, error: 'Unsupported authentication type' };
	}

	/**
	 * A simple password hashing function
	 * In a real application, use a proper hashing library with salt
	 */
	private async hashPassword(password: string): Promise<string> {
		console.log('[ShellServer] Hashing password...'); // Don't log the actual password
		const encoder = new TextEncoder();
		const data = encoder.encode(password);
		const hashBuffer = await crypto.subtle.digest('SHA-256', data);
		const hashArray = Array.from(new Uint8Array(hashBuffer));
		const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
		console.log('[ShellServer] Password hashing complete.');
		console.log(`[ShellServer] Hashed password: ${hashHex}`); // Don't log the full hash
		return hashHex;
	}

	/**
	 * Handle a connection error
	 */
	private async handleConnectionError(
		connectionId: string,
		// deno-lint-ignore no-explicit-any
		error: unknown,
	): Promise<void> {
		const errorMsg = error instanceof Error ? error.message : String(error);
		console.error(`[ShellServer][Conn ${connectionId}] Connection error:`, errorMsg);
		const connection = this.connections.get(connectionId);
		if (connection) {
			console.log(`[ShellServer][Conn ${connectionId}] Emitting ERROR event and disconnecting due to error.`);
			this.emitEvent(ServerEvent.ERROR, {
				connectionId,
				error: errorMsg,
			});
			await connection.disconnect('Connection error');
		} else {
			console.warn(`[ShellServer][Conn ${connectionId}] Connection error for non-existent/already removed connection.`);
		}
	}

	/**
	 * Start the ping interval to keep connections alive
	 */
	private startPingInterval(): void {
		console.log(`[ShellServer] Starting ping interval (${this.options.pingInterval}ms).`);
		// Clear any existing interval
		if (this.pingIntervalId) {
			clearInterval(this.pingIntervalId);
			console.log('[ShellServer] Cleared existing ping interval.');
		}

		// Set up new interval
		this.pingIntervalId = setInterval(() => {
			const now = Date.now();
			for (const [_id, connection] of this.connections) {
				// Check if connection is stale (no activity for 2x ping interval)
				if (now - connection.lastActivity > this.options.pingInterval! * 2) {
					console.warn(`[ShellServer][Conn ${connection.id}] Connection timed out. Disconnecting.`);
					connection.disconnect('Connection timeout').catch(() => {
						console.error(`[ShellServer][Conn ${connection.id}] Error during timeout disconnect (ignored).`);
						// Ignore disconnect errors
					});
					continue;
				}

				// Send ping to active connections
				connection.send({
					id: crypto.randomUUID(),
					type: MessageType.PING,
					timestamp: now,
				}).catch(() => {
					console.error(`[ShellServer][Conn ${connection.id}] Failed to send ping. Disconnecting.`);
					// If sending fails, disconnect the connection
					connection.disconnect('Failed to send ping').catch(() => {
						console.error(`[ShellServer][Conn ${connection.id}] Error during ping failure disconnect (ignored).`);
						// Ignore disconnect errors
					});
				});
			}
		}, this.options.pingInterval);
	}

	/**
	 * Stop the shell server
	 */
	public async stop(): Promise<void> {
		console.log('[ShellServer] Stopping server...');
		if (!this.isRunning) {
			console.warn('[ShellServer] Stop called but server is not running.');
			return;
		}

		console.log('[ShellServer] Setting isRunning to false.');
		this.isRunning = false;

		// Clear ping interval
		if (this.pingIntervalId) {
			console.log('[ShellServer] Clearing ping interval.');
			clearInterval(this.pingIntervalId);
			this.pingIntervalId = undefined;
		}

		// Disconnect all clients
		console.log('[ShellServer] Disconnecting all clients...');
		await this.disconnectAll();

		// Close the server
		if (this.server) {
			console.log('[ShellServer] Closing server listener...');
			// Close the listener (TCP or Unix socket)
			this.server.close();
			this.server = undefined;
			console.log('[ShellServer] Server listener closed.');
		}

		// Clean up Unix socket file if necessary
		if (this.options.socketPath) {
			console.log(`[ShellServer] Attempting to remove Unix socket file: ${this.options.socketPath}`);
			try {
				await Deno.remove(this.options.socketPath);
				console.log(`[ShellServer] Removed Unix socket file: ${this.options.socketPath}`);
			} catch {
				console.warn(`[ShellServer] Failed to remove Unix socket file (ignored): ${this.options.socketPath}`);
				// Ignore errors if the file doesn't exist
			}
		}
		console.log('[ShellServer] Server stopped.');
	}

	/**
	 * Disconnect all connected clients
	 */
	public async disconnectAll(): Promise<void> {
		const disconnectPromises: Promise<void>[] = [];
		const connectionCount = this.connections.size;
		console.log(`[ShellServer] Disconnecting ${connectionCount} client(s)...`);
		for (const connection of this.connections.values()) {
			console.log(`[ShellServer][Conn ${connection.id}] Adding disconnect promise.`);
			disconnectPromises.push(
				connection.disconnect('Server shutting down').catch(() => {
					console.error(`[ShellServer][Conn ${connection.id}] Error during disconnectAll disconnect (ignored).`);
					// Ignore disconnect errors
				}),
			);
		}
		await Promise.all(disconnectPromises);
		console.log(`[ShellServer] All disconnect promises settled. Clearing connections map.`);
		this.connections.clear();
		console.log(`[ShellServer] DisconnectAll complete. ${connectionCount} connection(s) processed.`);
	}

	/**
	 * Get a list of all active connections
	 */
	public getConnections(): Connection[] {
		console.log(`[ShellServer] getConnections called. Returning ${this.connections.size} connection(s).`);
		return Array.from(this.connections.values());
	}

	/**
	 * Register an event handler
	 */
	public on(event: ServerEvent, handler: (payload: unknown) => void): void {
		console.log(`[ShellServer] Registering handler for event: ${event}`);
		this.eventEmitter.on(event, handler);
	}

	/**
	 * Unregister an event handler
	 */
	public off(event: ServerEvent, handler: (payload: unknown) => void): void {
		console.log(`[ShellServer] Unregistering handler for event: ${event}`);
		this.eventEmitter.off(event, handler);
	}

	/**
	 * Emit an event
	 */
	private emitEvent(event: ServerEvent, payload: unknown): void {
		// Be cautious logging payload, could be large or sensitive depending on event type
		const payloadSummary = JSON.stringify(payload)?.substring(0, 100) || 'undefined';
		console.log(`[ShellServer] Emitting event: ${event}. Payload summary: ${payloadSummary}${payloadSummary.length === 100 ? '...' : ''}`);
		this.eventEmitter.emit(event, payload);
	}
}
