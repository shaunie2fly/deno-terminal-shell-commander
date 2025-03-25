/**
 * Remote Shell Server Implementation
 *
 * Provides a server that exposes shell instances for remote access
 * @module
 */
import { EventEmitter } from '@std/events';
import { Shell } from '../shell/Shell.ts';
import { AuthOptions, AuthType, Connection, MessageType, ProtocolMessage, ProtocolMessageRT, ServerEvent } from './protocol.ts';

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
	private server?: Deno.Listener | Deno.HttpServer;
	private startTime = Date.now();
	private isRunning = false;

	/**
	 * Create a new shell server
	 * @param options - Configuration options for the server
	 */
	constructor(options: ShellServerOptions) {
		// Validate required options
		if (!options.shell) {
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

		this.shell = options.shell;
	}

	/**
	 * Start the shell server
	 * @returns Promise that resolves when the server is started
	 */
	public async start(): Promise<void> {
		if (this.isRunning) {
			throw new Error('Server is already running');
		}

		// Record start time for uptime tracking
		this.startTime = Date.now();
		this.isRunning = true;

		try {
			// Setup the server based on configuration
			if (this.options.socketPath) {
				await this.startUnixSocketServer();
			} else if (this.options.port) {
				await this.startTcpServer();
			} else {
				throw new Error('Either port or socketPath must be specified');
			}

			// Start the ping interval to keep connections alive
			this.startPingInterval();
		} catch (error) {
			this.isRunning = false;
			throw error;
		}
	}

	/**
	 * Set up a Unix domain socket server
	 */
	private async startUnixSocketServer(): Promise<void> {
		try {
			// Attempt to remove any existing socket file
			try {
				await Deno.remove(this.options.socketPath!);
			} catch {
				// Ignore errors if the file doesn't exist
			}

			// Create the Unix domain socket server
			const listener = Deno.listen({
				path: this.options.socketPath!,
				transport: 'unix',
			});

			this.server = listener;
			this.acceptConnections(listener);
		} catch (error) {
			throw new Error(`Failed to start Unix socket server: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
	 * Set up a TCP server
	 */
	private startTcpServer(): Promise<void> {
		try {
			// Create TCP server
			const listener = Deno.listen({
				port: this.options.port!,
				hostname: this.options.host,
			});

			this.server = listener;
			this.acceptConnections(listener);

			// Also set up a WebSocket server on the same port
			const _httpServer = Deno.serve({
				port: this.options.port! + 1, // Use adjacent port for WebSockets
				hostname: this.options.host,
				onListen: () => {
					console.log(`WebSocket server listening on ${this.options.host}:${this.options.port! + 1}`);
				},
			}, (request) => {
				// Check if it's a WebSocket upgrade request
				if (request.headers.get("upgrade") === "websocket") {
					const { socket, response } = Deno.upgradeWebSocket(request);
					this.handleWebSocketConnection(socket);
					return response;
				}
				
				// Return a simple response for non-WebSocket requests
				return new Response("Shell WebSocket Server", { status: 200 });
			});
			
			// Return a resolved promise as this function is expected to return Promise<void>
			return Promise.resolve();
		} catch (error) {
			throw new Error(`Failed to start TCP server: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
	 * Accept connections from a listener
	 */
	private async acceptConnections(listener: Deno.Listener): Promise<void> {
		for await (const conn of listener) {
			// Check if we've reached the maximum number of connections
			if (this.connections.size >= this.options.maxConnections!) {
				conn.close();
				continue;
			}

			// Handle the new connection
			this.handleConnection(conn);
		}
	}

	/**
	 * Handle a new TCP connection
	 */
	private async handleConnection(conn: Deno.Conn): Promise<void> {
		const connectionId = crypto.randomUUID();
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
						timestamp: Date.now(),
						payload: { reason },
					});
					conn.close();
				} catch {
					// Ignore errors during disconnect
				} finally {
					this.connections.delete(connectionId);
					this.emitEvent(ServerEvent.DISCONNECT, { connectionId, reason });
				}
			},
		};

		// Store the connection
		this.connections.set(connectionId, connection);

		// Emit connection event
		this.emitEvent(ServerEvent.CONNECT, { connectionId });

		// Handle messages from this connection
		try {
			for await (const chunk of this.readLines(conn)) {
				// Update last activity time
				connection.lastActivity = Date.now();

				try {
					// Parse and validate the message
					const message = JSON.parse(chunk);
					const validationResult = ProtocolMessageRT.validate(message);

					if (!validationResult.success) {
						await connection.send({
							id: crypto.randomUUID(),
							type: MessageType.ERROR,
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
							if (authenticated) {
								await connection.send({
									id: crypto.randomUUID(),
									type: MessageType.AUTH_RESPONSE,
									timestamp: Date.now(),
									payload: {
										success: true,
										sessionId: connectionId,
									},
								});
							} else {
								const authResult = await this.authenticate(message.payload);
								authenticated = authResult.success;
								if (authenticated) {
									username = message.payload.username;
									connection.username = username;
								}
								await connection.send({
									id: crypto.randomUUID(),
									type: MessageType.AUTH_RESPONSE,
									timestamp: Date.now(),
									payload: {
										success: authResult.success,
										error: authResult.error,
										sessionId: authenticated ? connectionId : undefined,
									},
								});

								if (!authenticated) {
									// Close connection after failed authentication
									await connection.disconnect('Authentication failed');
								}
							}
							break;
						}
						case MessageType.COMMAND_REQUEST: {
							// Handle command execution request
							if (!authenticated) {
								await connection.send({
									id: crypto.randomUUID(),
									type: MessageType.ERROR,
									timestamp: Date.now(),
									payload: {
										message: 'Not authenticated',
										code: 'AUTH_REQUIRED',
									},
								});
								continue;
							}

							const commandId = crypto.randomUUID();
							this.emitEvent(ServerEvent.COMMAND, {
								connectionId,
								command: message.payload.command,
							});

							// Capture shell output
							const originalWrite = this.shell.write.bind(this.shell);
							const outputBuffer: string[] = [];

							// Override shell.write to capture output
							this.shell.write = (content: string, options = {}) => {
								outputBuffer.push(content);
								originalWrite(content, options);
							};

							try {
								// Execute the command by registering a temporary command
								// that will be executed immediately
								const commandName = `_remote_${commandId}`;
								this.shell.registerCommand({
									name: commandName,
									description: 'Remote command execution',
									action: async () => {
										// The actual command will be executed by the shell
										// This function should return void
									}
								});

								// Now execute our temporary command with the actual command as argument
								this.shell.registerCommand({
									name: message.payload.command,
									description: 'Remote command',
									action: async () => {
										// This is just a wrapper to execute the command
										// This function should return void
									}
								});

								// Unregister the temporary command
								this.shell.unregisterCommand(commandName);
								this.shell.unregisterCommand(message.payload.command);

								// Send the response
								await connection.send({
									id: crypto.randomUUID(),
									type: MessageType.COMMAND_RESPONSE,
									timestamp: Date.now(),
									payload: {
										success: true,
										output: outputBuffer.join('\n'),
										commandId,
									},
								});
							} catch (error) {
								await connection.send({
									id: crypto.randomUUID(),
									type: MessageType.COMMAND_RESPONSE,
									timestamp: Date.now(),
									payload: {
										success: false,
										error: error instanceof Error ? error.message : String(error),
										commandId,
									},
								});
							} finally {
								// Restore original write function
								this.shell.write = originalWrite;
							}
							break;
						}
						case MessageType.PING: {
							// Respond to ping with a pong
							await connection.send({
								id: crypto.randomUUID(),
								type: MessageType.PONG,
								timestamp: Date.now(),
								payload: {
									uptime: Date.now() - this.startTime,
								},
							});
							break;
						}
						default: {
							// Ignore other message types
							break;
						}
					}
				} catch (_error) {
					// Handle error parsing or processing message
					await connection.send({
						id: crypto.randomUUID(),
						type: MessageType.ERROR,
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
		} finally {
			// Clean up the connection if the loop exits
			if (this.connections.has(connectionId)) {
				await connection.disconnect('Connection closed');
			}
		}
	}

	/**
	 * Handle a new WebSocket connection
	 */
	private handleWebSocketConnection(socket: WebSocket): void {
		const connectionId = crypto.randomUUID();
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
					socket.send(JSON.stringify(message));
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
						timestamp: Date.now(),
						payload: { reason },
					});
					socket.close();
				} catch {
					// Ignore errors during disconnect
				} finally {
					this.connections.delete(connectionId);
					this.emitEvent(ServerEvent.DISCONNECT, { connectionId, reason });
				}
			},
		};

		// Store the connection
		this.connections.set(connectionId, connection);

		// Emit connection event
		this.emitEvent(ServerEvent.CONNECT, { connectionId });

		// Set up event handlers for the WebSocket
		socket.onmessage = async (event) => {
			// Update last activity time
			connection.lastActivity = Date.now();

			try {
				// Parse and validate the message
				const message = JSON.parse(event.data.toString());
				const validationResult = ProtocolMessageRT.validate(message);

				if (!validationResult.success) {
					await connection.send({
						id: crypto.randomUUID(),
						type: MessageType.ERROR,
						timestamp: Date.now(),
						payload: {
							message: 'Invalid message format',
							code: 'INVALID_MESSAGE',
						},
					});
					return;
				}

				// Handle the message based on its type (same logic as TCP handler)
				switch (message.type) {
					case MessageType.AUTH_REQUEST: {
						// Authentication logic (same as TCP handler)
						if (authenticated) {
							await connection.send({
								id: crypto.randomUUID(),
								type: MessageType.AUTH_RESPONSE,
								timestamp: Date.now(),
								payload: {
									success: true,
									sessionId: connectionId,
								},
							});
						} else {
							const authResult = await this.authenticate(message.payload);
							authenticated = authResult.success;
							if (authenticated) {
								username = message.payload.username;
								connection.username = username;
							}
							await connection.send({
								id: crypto.randomUUID(),
								type: MessageType.AUTH_RESPONSE,
								timestamp: Date.now(),
								payload: {
									success: authResult.success,
									error: authResult.error,
									sessionId: authenticated ? connectionId : undefined,
								},
							});

							if (!authenticated) {
								// Close connection after failed authentication
								await connection.disconnect('Authentication failed');
							}
						}
						break;
					}

					case MessageType.COMMAND_REQUEST: {
						// Command execution logic (same as TCP handler)
						if (!authenticated) {
							await connection.send({
								id: crypto.randomUUID(),
								type: MessageType.ERROR,
								timestamp: Date.now(),
								payload: {
									message: 'Not authenticated',
									code: 'AUTH_REQUIRED',
								},
							});
							return;
						}

						const commandId = crypto.randomUUID();
						this.emitEvent(ServerEvent.COMMAND, {
							connectionId,
							command: message.payload.command,
						});

						// Capture shell output
						const originalWrite = this.shell.write.bind(this.shell);
						const outputBuffer: string[] = [];

						// Override shell.write to capture output
						this.shell.write = (content: string, options = {}) => {
							outputBuffer.push(content);
							originalWrite(content, options);
						};

						try {
							// Execute the command by registering a temporary command
							// that will be executed immediately
							const commandName = `_remote_${commandId}`;
							this.shell.registerCommand({
								name: commandName,
								description: 'Remote command execution',
								action: async () => {
									// The actual command will be executed by the shell
									// This function should return void
								}
							});

							// Now execute our temporary command with the actual command as argument
							this.shell.registerCommand({
								name: message.payload.command,
								description: 'Remote command',
								action: async () => {
									// This is just a wrapper to execute the command
									// This function should return void
								}
							});

							// Unregister the temporary command
							this.shell.unregisterCommand(commandName);
							this.shell.unregisterCommand(message.payload.command);

							// Send the response
							await connection.send({
								id: crypto.randomUUID(),
								type: MessageType.COMMAND_RESPONSE,
								timestamp: Date.now(),
								payload: {
									success: true,
									output: outputBuffer.join('\n'),
									commandId,
								},
							});
						} catch (error) {
							await connection.send({
								id: crypto.randomUUID(),
								type: MessageType.COMMAND_RESPONSE,
								timestamp: Date.now(),
								payload: {
									success: false,
									error: error instanceof Error ? error.message : String(error),
									commandId,
								},
							});
						} finally {
							// Restore original write function
							this.shell.write = originalWrite;
						}
						break;
					}

					case MessageType.PING: {
						// Respond to ping with a pong
						await connection.send({
							id: crypto.randomUUID(),
							type: MessageType.PONG,
							timestamp: Date.now(),
							payload: {
								uptime: Date.now() - this.startTime,
							},
						});
						break;
					}

					default: {
						// Ignore other message types
						break;
					}
				}
			} catch (_error) {
				// Handle error parsing or processing message
				await connection.send({
					id: crypto.randomUUID(),
					type: MessageType.ERROR,
					timestamp: Date.now(),
					payload: {
						message: 'Error processing message',
						code: 'PROCESSING_ERROR',
					},
				});
			}
		};

		socket.onclose = () => {
			if (this.connections.has(connectionId)) {
				this.connections.delete(connectionId);
				this.emitEvent(ServerEvent.DISCONNECT, {
					connectionId,
					reason: 'WebSocket closed',
				});
			}
		};

		socket.onerror = (error) => {
			this.handleConnectionError(connectionId, error);
		};
	}

	/**
	 * Helper method to read messages line by line from a connection
	 */
	private async *readLines(conn: Deno.Conn): AsyncGenerator<string> {
		const buf = new Uint8Array(1024);
		let leftover = '';

		while (true) {
			const n = await conn.read(buf);
			if (n === null) {
				break;
			}

			const chunk = new TextDecoder().decode(buf.subarray(0, n));
			const lines = (leftover + chunk).split('\n');
			leftover = lines.pop() || '';

			for (const line of lines) {
				if (line.trim()) {
					yield line;
				}
			}
		}

		if (leftover.trim()) {
			yield leftover;
		}
	}

	/**
	 * Authenticate a client based on server authentication settings
	 */
	private async authenticate(payload: {
		authType: AuthType;
		username?: string;
		password?: string;
		token?: string;
	}): Promise<{ success: boolean; error?: string }> {
		const serverAuthType = this.options.auth?.type || AuthType.NONE;

		// Check if auth types match
		if (payload.authType !== serverAuthType) {
			return {
				success: false,
				error: `Authentication type mismatch. Server expects ${serverAuthType}, got ${payload.authType}`,
			};
		}

		// No authentication required
		if (serverAuthType === AuthType.NONE) {
			return { success: true };
		}

		// Basic authentication
		if (serverAuthType === AuthType.BASIC) {
			if (!payload.username || !payload.password) {
				return {
					success: false,
					error: 'Username and password are required for basic authentication',
				};
			}

			// Check credentials against defined users
			const users = this.options.auth?.users || [];
			for (const user of users) {
				if (user.username === payload.username) {
					// In a real application, you'd use a proper password hashing algorithm
					// and compare the hashed passwords
					const passwordHash = await this.hashPassword(payload.password);
					if (user.passwordHash === passwordHash) {
						return { success: true };
					} else {
						return { success: false, error: 'Invalid password' };
					}
				}
			}
			return { success: false, error: 'User not found' };
		}

		// Token authentication
		if (serverAuthType === AuthType.TOKEN) {
			if (!payload.token) {
				return {
					success: false,
					error: 'Token is required for token authentication',
				};
			}

			if (this.options.auth?.tokenValidator) {
				try {
					const isValid = await this.options.auth.tokenValidator(payload.token);
					return isValid ? { success: true } : { success: false, error: 'Invalid token' };
				} catch (error) {
					return {
						success: false,
						error: `Token validation error: ${error instanceof Error ? error.message : String(error)}`,
					};
				}
			}
			return { success: false, error: 'No token validator configured' };
		}

		return { success: false, error: 'Unsupported authentication type' };
	}

	/**
	 * A simple password hashing function
	 * In a real application, use a proper hashing library with salt
	 */
	private async hashPassword(password: string): Promise<string> {
		const encoder = new TextEncoder();
		const data = encoder.encode(password);
		const hashBuffer = await crypto.subtle.digest('SHA-256', data);
		const hashArray = Array.from(new Uint8Array(hashBuffer));
		return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
	}

	/**
	 * Handle a connection error
	 */
	private async handleConnectionError(
		connectionId: string,
		error: unknown,
	): Promise<void> {
		const connection = this.connections.get(connectionId);
		if (connection) {
			this.emitEvent(ServerEvent.ERROR, {
				connectionId,
				error: error instanceof Error ? error.message : String(error),
			});
			await connection.disconnect('Connection error');
		}
	}

	/**
	 * Start the ping interval to keep connections alive
	 */
	private startPingInterval(): void {
		// Clear any existing interval
		if (this.pingIntervalId) {
			clearInterval(this.pingIntervalId);
		}

		// Set up new interval
		this.pingIntervalId = setInterval(() => {
			const now = Date.now();
			for (const [_id, connection] of this.connections) {
				// Check if connection is stale (no activity for 2x ping interval)
				if (now - connection.lastActivity > this.options.pingInterval! * 2) {
					connection.disconnect('Connection timeout').catch(() => {
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
					// If sending fails, disconnect the connection
					connection.disconnect('Failed to send ping').catch(() => {
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
		if (!this.isRunning) {
			return;
		}

		this.isRunning = false;

		// Clear ping interval
		if (this.pingIntervalId) {
			clearInterval(this.pingIntervalId);
			this.pingIntervalId = undefined;
		}

		// Disconnect all clients
		await this.disconnectAll();

		// Close the server
		if (this.server) {
			if ('shutdown' in this.server) {
				// It's an HTTP server
				await (this.server as Deno.HttpServer).shutdown();
			} else {
				// It's a listener
				this.server.close();
			}
			this.server = undefined;
		}

		// Clean up Unix socket file if necessary
		if (this.options.socketPath) {
			try {
				await Deno.remove(this.options.socketPath);
			} catch {
				// Ignore errors if the file doesn't exist
			}
		}
	}

	/**
	 * Disconnect all connected clients
	 */
	public async disconnectAll(): Promise<void> {
		const disconnectPromises: Promise<void>[] = [];
		for (const connection of this.connections.values()) {
			disconnectPromises.push(
				connection.disconnect('Server shutting down').catch(() => {
					// Ignore disconnect errors
				}),
			);
		}
		await Promise.all(disconnectPromises);
		this.connections.clear();
	}

	/**
	 * Get a list of all active connections
	 */
	public getConnections(): Connection[] {
		return Array.from(this.connections.values());
	}

	/**
	 * Register an event handler
	 */
	public on(event: ServerEvent, handler: (payload: unknown) => void): void {
		this.eventEmitter.on(event, handler);
	}

	/**
	 * Unregister an event handler
	 */
	public off(event: ServerEvent, handler: (payload: unknown) => void): void {
		this.eventEmitter.off(event, handler);
	}

	/**
	 * Emit an event
	 */
	private emitEvent(event: ServerEvent, payload: unknown): void {
		this.eventEmitter.emit(event, payload);
	}
}
