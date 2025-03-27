/**
 * Remote Shell Server Implementation
 *
 * Provides a server that exposes shell instances for remote access
 * @module
 */
import { EventEmitter } from 'node:events';
import { Shell } from '../shell/Shell.ts';
import { AuthOptions, AuthType, Connection, InputMessage, MessageType, ProtocolMessage, ProtocolMessageRT, ServerEvent } from './protocol.ts';
import { ShellEventType } from '../shell/types.ts'; // Keep this import

/**
 * Configuration options for the shell server
 */
export interface ShellServerOptions {
	// Removed shell property
	/** TCP port to listen on (optional) */
	port?: number;
    /** Default prompt for new shell instances */
	defaultPrompt?: string; // Added this line correctly
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
    // TODO: Add options for configuring newly created Shell instances (e.g., name, base commands)
}

/**
 * Server for exposing shell instances over network protocols
 */
export class ShellServer {
	// Removed private shell property
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
		// Validate required options (port or socketPath needed later in start)
		console.log('[ShellServer] Initializing with options:', options);
		// Removed shell instance validation/assignment

		// Set defaults for optional parameters
		this.options = {
			...options,
			host: options.host || 'localhost',
            defaultPrompt: options.defaultPrompt || 'remote> ', // Added default prompt handling
			auth: options.auth || { type: AuthType.NONE },
			pingInterval: options.pingInterval || 30000,
			maxConnections: options.maxConnections || 10,
		};

		console.log('[ShellServer] Final configuration:', this.options);
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

            // Removed global shell stop listener - now handled per connection

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
		// ... (Existing implementation) ...
		try {
			console.log(`[ShellServer] Attempting to remove existing socket file: ${this.options.socketPath}`);
			try {
				await Deno.remove(this.options.socketPath!);
				console.log(`[ShellServer] Removed existing socket file: ${this.options.socketPath}`);
			} catch {
				console.log(`[ShellServer] No existing socket file found or removal failed (ignored): ${this.options.socketPath}`);
			}

			console.log(`[ShellServer] Creating Unix domain socket listener at: ${this.options.socketPath}`);
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
		// ... (Existing implementation) ...
        try {
			console.log(`[ShellServer] Creating TCP listener on: ${this.options.host}:${this.options.port}`);
			const listener = Deno.listen({
				port: this.options.port!,
				hostname: this.options.host,
			});

			this.server = listener;
			this.acceptConnections(listener);

			console.log(`[ShellServer] TCP server listening on: ${this.options.host}:${this.options.port}`);
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
		// ... (Existing implementation) ...
        const addr = listener.addr;
		console.log(`[ShellServer] Accepting connections on ${addr.transport}://${'hostname' in addr ? addr.hostname + ':' + addr.port : addr.path}...`);
		for await (const conn of listener) {
			const remoteAddr = conn.remoteAddr;
			const remoteAddrString = `${remoteAddr.transport}://${'hostname' in remoteAddr ? remoteAddr.hostname + ':' + remoteAddr.port : 'unix'}`;
			console.log(`[ShellServer] Incoming connection from: ${remoteAddrString}`);
			if (this.connections.size >= this.options.maxConnections!) {
				console.warn(`[ShellServer] Max connections (${this.options.maxConnections}) reached. Rejecting connection from ${remoteAddrString}.`);
				conn.close();
				continue;
			}

			console.log(`[ShellServer] Accepting connection from: ${remoteAddrString}`);
			this.handleConnection(conn); // Do not await, handle each connection concurrently
		}
		console.log(`[ShellServer] Stopped accepting connections on ${addr.transport}://${'hostname' in addr ? addr.hostname + ':' + addr.port : addr.path}.`);
	}

	/**
	 * Handle a new connection, creating a Shell instance for it.
	 */
	private async handleConnection(conn: Deno.Conn): Promise<void> {
		const connectionId = crypto.randomUUID();
		const remoteAddr = conn.remoteAddr;
		const remoteAddrString = `${remoteAddr.transport}://${'hostname' in remoteAddr ? remoteAddr.hostname + ':' + remoteAddr.port : 'unix'}`;
		console.log(`[ShellServer][Conn ${connectionId}] Handling new connection from ${remoteAddrString}`);

		let authenticated = this.options.auth?.type === AuthType.NONE;
		let username: string | undefined;
        let shellInstanceForConn: Shell | undefined; // Variable to hold the shell for this connection

		// Create a connection object to track this connection
		const connection: Connection = {
			id: connectionId,
			username,
			connected: true,
			connectedAt: Date.now(),
			lastActivity: Date.now(),
            shellInstance: undefined, // Initialize as undefined
			send: async (message: ProtocolMessage) => {
				if (!connection.connected) return; // Don't send if already disconnected
				try {
					const data = new TextEncoder().encode(JSON.stringify(message) + '\n');
					await conn.write(data);
				} catch (error) {
					// Error during send likely means connection issue
					await this.handleConnectionError(connectionId, error);
				}
			},
			disconnect: async (reason: string) => {
                if (!connection.connected) return; // Prevent double disconnects
                connection.connected = false; // Mark as disconnected immediately

                console.log(`[ShellServer][Conn ${connectionId}] Disconnecting. Reason: ${reason}`);
				try {
                    // Stop the associated shell instance first
                    await connection.shellInstance?.stop(); // Use optional chaining

					// Send disconnect message before closing socket
					await connection.send({
						id: crypto.randomUUID(),
						type: MessageType.DISCONNECT,
						timestamp: Date.now(),
						payload: { reason },
					});
                    conn.close(); // Close the underlying Deno connection
				} catch (err){
					console.warn(`[ShellServer][Conn ${connectionId}] Error during disconnect sequence (ignoring):`, err);
                    try { conn.close(); } catch { /* ensure close */ } // Force close if send failed
				} finally {
					this.connections.delete(connectionId);
					console.log(`[ShellServer][Conn ${connectionId}] Connection closed and removed.`);
					this.emitEvent(ServerEvent.DISCONNECT, { connectionId, reason });
				}
			},
		};

		this.connections.set(connectionId, connection);
		console.log(`[ShellServer][Conn ${connectionId}] Connection stored. Total connections: ${this.connections.size}`);
		this.emitEvent(ServerEvent.CONNECT, { connectionId });

		// Handle messages from this connection
		try {
			for await (const chunk of this.readLines(conn)) {
				// console.log(`[ShellServer][Conn ${connectionId}] Received chunk: ${chunk.substring(0, 100)}${chunk.length > 100 ? '...' : ''}`); // Verbose
				connection.lastActivity = Date.now();

				try {
					const message = JSON.parse(chunk);
					const validationResult = ProtocolMessageRT.validate(message);

					// console.log(`[ShellServer][Conn ${connectionId}] Parsed message type: ${message.type}`); // Verbose
					if (!validationResult.success) {
						console.warn(`[ShellServer][Conn ${connectionId}] Invalid message format received:`, validationResult.message);
						await connection.send({
							id: crypto.randomUUID(), type: MessageType.ERROR, timestamp: Date.now(),
							payload: { message: 'Invalid message format', code: 'INVALID_MESSAGE' },
						});
						continue;
					}
                    const validatedMessage = validationResult.value;

					// Handle messages based on type
					switch (validatedMessage.type) {
						case MessageType.AUTH_REQUEST: {
							console.log(`[ShellServer][Conn ${connectionId}] Processing AUTH_REQUEST`);
							if (authenticated) { // Already authenticated (e.g., re-auth attempt?)
								await connection.send({
									id: validatedMessage.id, type: MessageType.AUTH_RESPONSE, timestamp: Date.now(),
									payload: { success: true, sessionId: connectionId },
								});
							} else {
								const authResult = await this.authenticate(validatedMessage.payload);
								authenticated = authResult.success;
								if (authenticated) {
									username = validatedMessage.payload.username;
									connection.username = username;
                                    console.log(`[ShellServer][Conn ${connectionId}] Authentication successful for user: ${username}`);

									// --- Create and Start Shell Instance for this Connection ---
									shellInstanceForConn = new Shell({ // Create a NEW shell
									    name: `Remote Shell (${username || connectionId.substring(0, 4)})`,
									    prompt: this.options.defaultPrompt, // Use configured prompt
									    width:  undefined,  // Explicitly undefined
									    height: undefined, // Explicitly undefined
									    commands:  undefined // Explicitly undefined
									});
                                    connection.shellInstance = shellInstanceForConn; // Store it on the connection

									const sendOutput = (data: string) => {
										connection.send({
											id: crypto.randomUUID(), type: MessageType.OUTPUT, timestamp: Date.now(),
											payload: { content: data, final: false, commandId: connectionId }, // Use connectionId as a general ID
										}).catch(err => console.error(`[ShellServer][Conn ${connectionId}] Error sending output:`, err));
									};

									const processInput = async (command: string) => {
                                        // Pass command to the connection's specific shell instance
                                        if (connection.shellInstance) {
										    await connection.shellInstance.executeCommand(command);
                                        }
									};

                                    // Listen for the STOP event *on this specific shell instance*
                                    shellInstanceForConn.on(ShellEventType.STOP, () => {
                                        console.log(`[ShellServer][Conn ${connectionId}] Shell instance stopped. Disconnecting client.`);
                                        // Use a non-awaited call to avoid blocking message loop if disconnect takes time
                                        connection.disconnect('Shell exited').catch(err => console.error(`Error during disconnect on shell stop:`, err));
                                    });

									await shellInstanceForConn.start(processInput, sendOutput);
                                    console.log(`[ShellServer][Conn ${connectionId}] Shell instance started.`);
                                    // --- Shell instance started ---
								}
                                // Send Auth Response
								await connection.send({
									id: validatedMessage.id, type: MessageType.AUTH_RESPONSE, timestamp: Date.now(),
									payload: { success: authResult.success, error: authResult.error, sessionId: authenticated ? connectionId : undefined, },
								});

								if (!authenticated) {
									console.log(`[ShellServer][Conn ${connectionId}] Authentication failed, disconnecting.`);
									await connection.disconnect('Authentication failed'); // Disconnect immediately on failure
								}
							}
							break;
						}

						case MessageType.INPUT: {
							if (!authenticated || !connection.shellInstance) {
								console.warn(`[ShellServer][Conn ${connectionId}] INPUT received but not authenticated or shell not ready.`);
                                if (!authenticated) {
								    await connection.send({
								    	id: crypto.randomUUID(), type: MessageType.ERROR, timestamp: Date.now(),
								    	payload: { message: 'Not authenticated', code: 'AUTH_REQUIRED' },
								    });
                                }
								continue;
							}

							const inputMessage = validatedMessage as InputMessage;
							if (typeof inputMessage.payload?.data === 'string') {
								// console.log(`[ShellServer][Conn ${connectionId}] Processing INPUT data: ${inputMessage.payload.data.substring(0, 50)}...`); // Verbose
								const inputDataBytes = new TextEncoder().encode(inputMessage.payload.data);
								connection.shellInstance.handleInputData(inputDataBytes); // Pass to the connection's shell
							} else {
								console.warn(`[ShellServer][Conn ${connectionId}] Invalid INPUT message payload:`, inputMessage.payload);
							}
							break;
						}

						case MessageType.PING: {
							await connection.send({
								id: crypto.randomUUID(), type: MessageType.PONG, timestamp: Date.now(),
								payload: { uptime: Date.now() - this.startTime },
							});
							break;
						}
						case MessageType.PONG: {
							// console.log(`[ShellServer][Conn ${connectionId}] Received PONG.`); // Verbose
							break;
						}
						default: {
							console.log(`[ShellServer][Conn ${connectionId}] Ignoring unhandled message type: ${validatedMessage.type}`);
							break;
						}
					}
				} catch (parseError) {
					console.error(`[ShellServer][Conn ${connectionId}] Error processing message JSON:`, parseError, "Raw chunk:", chunk);
					await connection.send({
						id: crypto.randomUUID(), type: MessageType.ERROR, timestamp: Date.now(),
						payload: { message: 'Error processing message', code: 'PROCESSING_ERROR' },
					});
				}
			}
		} catch (readError) {
            // Handle errors during the read loop (e.g., connection closed abruptly)
			if (connection.connected) { // Only handle if we didn't disconnect intentionally
			    await this.handleConnectionError(connectionId, readError);
            } else {
                console.log(`[ShellServer][Conn ${connectionId}] Read loop terminated for disconnected client.`);
            }
		} finally {
			// Final cleanup when the read loop exits for any reason
            console.log(`[ShellServer][Conn ${connectionId}] Read loop finished. Cleaning up connection.`);
			if (this.connections.has(connectionId)) {
                // Ensure disconnection logic runs if not already disconnected
				await connection.disconnect('Connection closed or read loop exited'); // This now also stops the shell
			}
            // No need to call shellInstanceForConn?.stop() here anymore,
            // as connection.disconnect() handles it.
		}
	}


	/**
	 * Helper method to read messages line by line from a connection
	 */
	private async *readLines(conn: Deno.Conn): AsyncGenerator<string> {
		// ... (Existing implementation with error handling) ...
        const buf = new Uint8Array(1024);
		// console.log(`[ShellServer][readLines] Starting generator for a connection.`); // Simplified log
		let leftover = '';

		while (true) {
            let n: number | null;
            try {
			    n = await conn.read(buf);
            } catch (readErr) {
                console.error(`[ShellServer][readLines] Read error:`, readErr);
                break;
            }

			if (n === null) {
				console.log(`[ShellServer][readLines] Read returned null, ending loop.`);
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
			console.log(`[ShellServer][readLines] Yielding leftover data: ${leftover.substring(0, 100)}${leftover.length > 100 ? '...' : ''}`);
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
	}): Promise<{ success: boolean; error?: string }> {
		// ... (Existing implementation) ...
        console.log(`[ShellServer] Authenticating connection... AuthType provided: ${payload.authType}`);
		const serverAuthType = this.options.auth?.type || AuthType.NONE;

		if (payload.authType !== serverAuthType) {
			console.warn(`[ShellServer] Authentication failed: Type mismatch. Server: ${serverAuthType}, Client: ${payload.authType}`);
			return { success: false, error: `Authentication type mismatch. Server expects ${serverAuthType}, got ${payload.authType}`};
		}

		if (serverAuthType === AuthType.NONE) {
			console.log(`[ShellServer] Authentication successful (AuthType: NONE).`);
			return { success: true };
		}

		if (serverAuthType === AuthType.BASIC) {
			console.log(`[ShellServer] Attempting Basic authentication for user: ${payload.username}`);
			if (!payload.username || !payload.password) {
				console.warn('[ShellServer] Basic Auth failed: Username or password missing.');
				return { success: false, error: 'Username and password are required for basic authentication' };
			}
			const users = this.options.auth?.users || [];
			for (const user of users) {
				if (user.username === payload.username) {
					console.log(`[ShellServer] Found user: ${user.username}. Verifying password...`);
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

		if (serverAuthType === AuthType.TOKEN) {
            console.log(`[ShellServer] Attempting Token authentication.`);
			if (!payload.token) {
				console.warn('[ShellServer] Token Auth failed: Token missing.');
				return { success: false, error: 'Token is required for token authentication' };
			}
			if (this.options.auth?.tokenValidator) {
				try {
					const isValid = await this.options.auth.tokenValidator(payload.token);
					console.log(`[ShellServer] Token validation result: ${isValid}`);
					return isValid ? { success: true } : { success: false, error: 'Invalid token' };
				} catch (error) {
					console.error('[ShellServer] Token validation error:', error);
					return { success: false, error: `Token validation error: ${error instanceof Error ? error.message : String(error)}` };
				}
			}
			console.warn('[ShellServer] Token Auth failed: No token validator configured.');
			return { success: false, error: 'No token validator configured' };
		}

		console.error(`[ShellServer] Authentication failed: Unsupported auth type ${serverAuthType}.`);
		return { success: false, error: 'Unsupported authentication type' };
	}

	/**
	 * A simple password hashing function
	 */
	private async hashPassword(password: string): Promise<string> {
		// ... (Existing implementation) ...
        console.log('[ShellServer] Hashing password...');
		const encoder = new TextEncoder();
		const data = encoder.encode(password);
		const hashBuffer = await crypto.subtle.digest('SHA-256', data);
		const hashArray = Array.from(new Uint8Array(hashBuffer));
		const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
		console.log('[ShellServer] Password hashing complete.');
		return hashHex;
	}

	/**
	 * Handle a connection error
	 */
	private async handleConnectionError(
		connectionId: string,
		error: unknown,
	): Promise<void> {
		// ... (Existing implementation) ...
        const errorMsg = error instanceof Error ? error.message : String(error);
		console.error(`[ShellServer][Conn ${connectionId}] Connection error:`, errorMsg);
		const connection = this.connections.get(connectionId);
		if (connection) {
			console.log(`[ShellServer][Conn ${connectionId}] Emitting ERROR event and disconnecting due to error.`);
			this.emitEvent(ServerEvent.ERROR, { connectionId, error: errorMsg });
			await connection.disconnect('Connection error');
		} else {
			console.warn(`[ShellServer][Conn ${connectionId}] Connection error for non-existent/already removed connection.`);
		}
	}

	/**
	 * Start the ping interval to keep connections alive
	 */
	private startPingInterval(): void {
		// ... (Existing implementation) ...
        console.log(`[ShellServer] Starting ping interval (${this.options.pingInterval}ms).`);
		if (this.pingIntervalId) {
			clearInterval(this.pingIntervalId);
			console.log('[ShellServer] Cleared existing ping interval.');
		}

		this.pingIntervalId = setInterval(() => {
			const now = Date.now();
			for (const connection of this.connections.values()) {
				if (now - connection.lastActivity > this.options.pingInterval! * 2) {
					console.warn(`[ShellServer][Conn ${connection.id}] Connection timed out. Disconnecting.`);
					connection.disconnect('Connection timeout').catch(() => {/* ignore */});
					continue;
				}

				connection.send({
					id: crypto.randomUUID(), type: MessageType.PING, timestamp: now,
				}).catch(() => {
					console.error(`[ShellServer][Conn ${connection.id}] Failed to send ping. Disconnecting.`);
					connection.disconnect('Failed to send ping').catch(() => { /* ignore */});
				});
			}
		}, this.options.pingInterval);
	}

	/**
	 * Stop the shell server
	 */
	public async stop(): Promise<void> {
		// ... (Existing implementation) ...
        console.log('[ShellServer] Stopping server...');
		if (!this.isRunning) {
			console.warn('[ShellServer] Stop called but server is not running.');
			return;
		}
		this.isRunning = false;

		if (this.pingIntervalId) {
			console.log('[ShellServer] Clearing ping interval.');
			clearInterval(this.pingIntervalId);
			this.pingIntervalId = undefined;
		}

		console.log('[ShellServer] Disconnecting all clients...');
		await this.disconnectAll();

		if (this.server) {
			console.log('[ShellServer] Closing server listener...');
			this.server.close();
			this.server = undefined;
			console.log('[ShellServer] Server listener closed.');
		}

		if (this.options.socketPath) {
			console.log(`[ShellServer] Attempting to remove Unix socket file: ${this.options.socketPath}`);
			try {
				await Deno.remove(this.options.socketPath);
				console.log(`[ShellServer] Removed Unix socket file: ${this.options.socketPath}`);
			} catch {
				console.warn(`[ShellServer] Failed to remove Unix socket file (ignored): ${this.options.socketPath}`);
			}
		}
		console.log('[ShellServer] Server stopped.');
	}

	/**
	 * Disconnect all connected clients
	 */
	public async disconnectAll(): Promise<void> {
        // ... (Existing implementation) ...
        const disconnectPromises: Promise<void>[] = [];
		const connectionIds = Array.from(this.connections.keys());
		console.log(`[ShellServer] Disconnecting ${connectionIds.length} client(s)...`);

		for (const connectionId of connectionIds) {
            const connection = this.connections.get(connectionId);
			if (connection) {
                console.log(`[ShellServer][Conn ${connection.id}] Adding disconnect promise.`);
			    disconnectPromises.push(
			    	connection.disconnect('Server shutting down').catch((err) => {
			    		console.error(`[ShellServer][Conn ${connection.id}] Error during disconnectAll disconnect (ignored):`, err);
			    	}),
			    );
            }
		}
		await Promise.all(disconnectPromises);
		console.log(`[ShellServer] All disconnect promises settled.`);
        if (this.connections.size > 0) {
             console.warn(`[ShellServer] Connections map not empty after disconnectAll (${this.connections.size} remaining). Force clearing.`);
             this.connections.clear();
        }
		console.log(`[ShellServer] DisconnectAll complete.`);
	}

	/**
	 * Get a list of all active connections
	 */
	public getConnections(): Connection[] {
		// ... (Existing implementation) ...
        console.log(`[ShellServer] getConnections called. Returning ${this.connections.size} connection(s).`);
		return Array.from(this.connections.values());
	}

	/**
	 * Register an event handler
	 */
	public on(event: ServerEvent, handler: (payload: unknown) => void): void {
		// ... (Existing implementation) ...
        console.log(`[ShellServer] Registering handler for event: ${event}`);
		this.eventEmitter.on(event, handler);
	}

	/**
	 * Unregister an event handler
	 */
	public off(event: ServerEvent, handler: (payload: unknown) => void): void {
		// ... (Existing implementation) ...
        console.log(`[ShellServer] Unregistering handler for event: ${event}`);
		this.eventEmitter.off(event, handler);
	}

	/**
	 * Emit an event
	 */
	private emitEvent(event: ServerEvent, payload: unknown): void {
		// ... (Existing implementation) ...
        const payloadSummary = JSON.stringify(payload)?.substring(0, 100) || 'undefined';
		console.log(`[ShellServer] Emitting event: ${event}. Payload summary: ${payloadSummary}${payloadSummary.length === 100 ? '...' : ''}`);
		this.eventEmitter.emit(event, payload);
	}
}
