/**
 * Remote Shell Server Implementation
 *
 * Provides a server that exposes shell instances for remote access
 * @module
 */
import { EventEmitter } from 'node:events';
import { Shell } from '../shell/Shell.ts';
import { type AuthOptions, AuthType, type Connection, MessageType, type ProtocolMessage, ProtocolMessageRT, ServerEvent } from './protocol.ts';
import { ShellEventType } from '../shell/types.ts';
import type { Command } from '../commands/types.ts'; 


/**
 * Configuration options for the shell server
 */
export interface ShellServerOptions {
	// Removed shell property
	/** TCP port to listen on (optional) */
	port?: number;
    /** Default prompt for new shell instances */
	defaultPrompt?: string; 
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
   /** Array of base commands to register on each new shell instance */
baseCommands?: Command[];
}

/**
 * Server for exposing shell instances over network protocols (TCP or Unix domain sockets).
 * Each connected client gets its own dedicated `Shell` instance after successful authentication.
 * Manages client connections, authentication, message handling, and shell lifecycle.
 *
 * @example
 * ```typescript
 * // Basic TCP Server
 * const server = new ShellServer({ port: 8080 });
 * await server.start();
 * console.log('Server listening on port 8080');
 *
 * // Server with Basic Authentication
 * const serverAuth = new ShellServer({
 *   port: 8081,
 *   auth: {
 *     type: AuthType.BASIC,
 *     users: [{ username: 'admin', passwordHash: await server.hashPassword('secret') }] // Use public hashPassword
 *   }
 * });
 * await serverAuth.start();
 * ```
 *
 * @emits ServerEvent.CONNECT - When a client connects (before authentication). Payload: `{ connectionId: string }`
 * @emits ServerEvent.DISCONNECT - When a client disconnects. Payload: `{ connectionId: string, reason: string }`
 * @emits ServerEvent.ERROR - When a connection error occurs. Payload: `{ connectionId: string, error: string }`
 * @emits ServerEvent.AUTHENTICATED - When a client successfully authenticates. Payload: `{ connectionId: string, username?: string }`
 * @emits ServerEvent.SHELL_STARTED - When a shell instance is started for a connection. Payload: `{ connectionId: string }`
 * @emits ServerEvent.SHELL_STOPPED - When a shell instance stops for a connection. Payload: `{ connectionId: string }`
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
	 * Creates a new `ShellServer` instance.
	 *
	 * @param options - Configuration options for the server, specifying how it should listen (port/socket),
	 *                  authentication methods, connection limits, etc.
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
		baseCommands: options.baseCommands || [], // Store base commands
		};

		console.log('[ShellServer] Final configuration:', this.options);
	}

	/**
	 * Starts the shell server, listening for incoming connections on the configured
	 * TCP port or Unix domain socket.
	 * It sets up the appropriate listener and begins accepting connections.
	 *
	 * @returns A promise that resolves when the server has successfully started listening,
	 *          or rejects if starting fails (e.g., port in use, invalid configuration).
	 * @throws {Error} If the server is already running.
	 * @throws {Error} If neither `port` nor `socketPath` is specified in the options.
	 * @throws {Error} If the listener fails to bind (e.g., address in use, permissions error).
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
	 * Sets up and starts listening on a Unix domain socket.
	 * Handles potential cleanup of existing socket files.
	 *
	 * @private
	 * @throws {Error} If creating the listener or removing an existing socket file fails.
	 */
	private async startUnixSocketServer(): Promise<void> {
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
			this.acceptConnections(listener); // Do not await, runs in background
			console.log(`[ShellServer] Unix socket server listening at: ${this.options.socketPath}`);
		} catch (error) {
			console.error(`[ShellServer] Failed to start Unix socket server at ${this.options.socketPath}:`, error);
			throw new Error(`Failed to start Unix socket server: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
	 * Sets up and starts listening on a TCP port.
	 *
	 * @private
	 * @throws {Error} If creating the TCP listener fails (e.g., port already in use).
	 */
	private startTcpServer(): Promise<void> {
        try {
			console.log(`[ShellServer] Creating TCP listener on: ${this.options.host}:${this.options.port}`);
			const listener = Deno.listen({
				port: this.options.port!,
				hostname: this.options.host,
			});

			this.server = listener;
			this.acceptConnections(listener); // Do not await, runs in background

			console.log(`[ShellServer] TCP server listening on: ${this.options.host}:${this.options.port}`);
			return Promise.resolve(); // Return resolved promise as listener setup is synchronous
		} catch (error) {
			console.error(`[ShellServer] Failed to start TCP server on ${this.options.host}:${this.options.port}:`, error);
			throw new Error(`Failed to start TCP server: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	/**
	 * Asynchronously accepts incoming connections from the provided Deno listener.
	 * Runs in a loop until the listener is closed. Handles connection limits.
	 * Each accepted connection is passed to `handleConnection` for processing.
	 *
	 * @param listener - The Deno listener (TCP or Unix socket) to accept connections from.
	 * @private
	 */
	private async acceptConnections(listener: Deno.Listener): Promise<void> {
        const addr = listener.addr;
		console.log(`[ShellServer] Accepting connections on ${addr.transport}://${'hostname' in addr ? addr.hostname + ':' + addr.port : addr.path}...`);
		try {
		          for await (const conn of listener) {
		              const remoteAddr = conn.remoteAddr;
		              const remoteAddrString = `${remoteAddr.transport}://${'hostname' in remoteAddr ? remoteAddr.hostname + ':' + remoteAddr.port : 'unix'}`;
		              console.log(`[ShellServer] Incoming connection from: ${remoteAddrString}`);
		              if (this.connections.size >= this.options.maxConnections!) {
		                  console.warn(`[ShellServer] Max connections (${this.options.maxConnections}) reached. Rejecting connection from ${remoteAddrString}.`);
		                  conn.close(); // Close the connection immediately
		                  continue;
		              }

		              console.log(`[ShellServer] Accepting connection from: ${remoteAddrString}`);
		              this.handleConnection(conn).catch(err => {
		                  console.error(`[ShellServer] Unhandled error during handleConnection for ${remoteAddrString}:`, err);
		                  // Attempt to close connection if handleConnection fails catastrophically
		                  try { conn.close(); } catch { /* ignore */ }
		              }); // Do not await, handle each connection concurrently, catch potential top-level errors
		          }
		      } catch (acceptError) {
		          // Log errors occurring during the accept loop itself (e.g., listener closed unexpectedly)
		          console.error(`[ShellServer] Error accepting connections on ${addr.transport}://${'hostname' in addr ? addr.hostname + ':' + addr.port : addr.path}:`, acceptError);
		          // Consider if server needs to be stopped or attempt restart based on error type
		          if (this.isRunning) {
		              console.warn("[ShellServer] Accept loop failed while server was expected to be running. Server might be unstable.");
		              // Optionally attempt to stop the server cleanly
		              // this.stop().catch(stopErr => console.error("Error stopping server after accept failure:", stopErr));
		          }
		      } finally {
		          console.log(`[ShellServer] Stopped accepting connections on ${addr.transport}://${'hostname' in addr ? addr.hostname + ':' + addr.port : addr.path}.`);
		      }
	}

	/**
	 * Handles a newly accepted connection.
	 * Manages the connection lifecycle, including authentication, message processing,
	 * creating and managing a dedicated `Shell` instance, and cleanup on disconnection.
	 *
	 * @param conn - The raw Deno connection object.
	 * @private
	 */
	private async handleConnection(conn: Deno.Conn): Promise<void> {
		const connectionId = crypto.randomUUID();
		const remoteAddr = conn.remoteAddr;
		const remoteAddrString = `${remoteAddr.transport}://${'hostname' in remoteAddr ? remoteAddr.hostname + ':' + remoteAddr.port : 'unix'}`;
		console.log(`[ShellServer][Conn ${connectionId}] Handling new connection from ${remoteAddrString}`);

		let authenticated = this.options.auth?.type === AuthType.NONE;
		let username: string | undefined;
     //   let shellInstanceForConn: Shell | undefined; // Variable to hold the shell for this connection

		// Create a connection object to track this connection
		const connection: Connection = {
			id: connectionId,
			username,
			connected: true,
			connectedAt: Date.now(),
			lastActivity: Date.now(),
            shellInstance: undefined, // Initialize as undefined
			/** Sends a protocol message to the client */
			send: async (message: ProtocolMessage) => {
				if (!connection.connected) return; // Don't send if already disconnected
				try {
					// console.log(`[ShellServer][Conn ${connectionId}] Sending message type: ${message.type}`); // Verbose
					const data = new TextEncoder().encode(JSON.stringify(message) + '\n'); // Ensure newline separator
					await conn.write(data);
				} catch (error) {
					// Error during send likely means connection issue
			                 console.error(`[ShellServer][Conn ${connectionId}] Error sending message:`, error);
					await this.handleConnectionError(connectionId, error);
				}
			},
			/** Disconnects the client, stops the associated shell, and cleans up resources */
			disconnect: async (reason: string) => {
			             if (!connection.connected) return; // Prevent double disconnects
			             connection.connected = false; // Mark as disconnected immediately to prevent further sends/reads

			             console.log(`[ShellServer][Conn ${connectionId}] Disconnecting. Reason: ${reason}`);
				try {
			                 // Stop the associated shell instance first, if it exists
			                 if (connection.shellInstance) {
			                     console.log(`[ShellServer][Conn ${connectionId}] Stopping associated shell instance...`);
			                     await connection.shellInstance.stop();
			                     console.log(`[ShellServer][Conn ${connectionId}] Shell instance stopped.`);
			                     this.emitEvent(ServerEvent.SHELL_STOPPED, { connectionId });
			                 }

					// Attempt to send a final disconnect message before closing socket
			                 // This might fail if the connection is already broken, hence the inner try/catch
			                 try {
			                     await connection.send({
			                         id: crypto.randomUUID(),
			                         type: MessageType.DISCONNECT,
			                         timestamp: Date.now(),
			                         payload: { reason },
			                     });
			                 } catch (sendErr) {
			                     console.warn(`[ShellServer][Conn ${connectionId}] Failed to send final disconnect message (ignoring):`, sendErr);
			                 }

			                 conn.close(); // Close the underlying Deno connection
				} catch (err){
					console.warn(`[ShellServer][Conn ${connectionId}] Error during disconnect sequence (ignoring):`, err);
			                 try { conn.close(); } catch { /* ensure close if shell stop failed */ } // Force close
				} finally {
			                 // Ensure removal from the map even if errors occurred
			                 if (this.connections.delete(connectionId)) {
					    console.log(`[ShellServer][Conn ${connectionId}] Connection closed and removed. Total connections: ${this.connections.size}`);
			                 }
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

				let validatedMessage: ProtocolMessage;
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
						continue; // Skip processing this invalid message
					}
                    validatedMessage = validationResult.value;

				} catch (parseError) {
					console.error(`[ShellServer][Conn ${connectionId}] Error parsing message JSON:`, parseError, "Raw chunk:", chunk);
					await connection.send({
						id: crypto.randomUUID(), type: MessageType.ERROR, timestamp: Date.now(),
						payload: { message: 'Error parsing message JSON', code: 'INVALID_JSON' },
					});
					continue; // Skip processing this unparseable message
				}


				// Handle messages based on type
				switch (validatedMessage.type) {
					case MessageType.AUTH_REQUEST: {
						console.log(`[ShellServer][Conn ${connectionId}] Processing AUTH_REQUEST`);
						if (authenticated && connection.shellInstance) { // Already authenticated and shell exists
							console.log(`[ShellServer][Conn ${connectionId}] Already authenticated. Sending success response.`);
							await connection.send({
								id: validatedMessage.id, type: MessageType.AUTH_RESPONSE, timestamp: Date.now(),
								payload: { success: true, sessionId: connectionId },
							});
						} else if (authenticated && !connection.shellInstance) {
							console.warn(`[ShellServer][Conn ${connectionId}] Authenticated but shell instance missing. Attempting to recreate.`);
							// This state ideally shouldn't happen, but try to recover
							try { // Wrap recovery attempt
								await this.initializeShellForConnection(connection); // Re-run shell init
								await connection.send({
									id: validatedMessage.id, type: MessageType.AUTH_RESPONSE, timestamp: Date.now(),
									payload: { success: true, sessionId: connectionId },
								});
							} catch (initError) {
								// initializeShellForConnection already handles disconnect on error
								console.error(`[ShellServer][Conn ${connectionId}] Error during recovery shell initialization:`, initError);
								// No need to disconnect again here, already handled.
							}
						} else { // Not yet authenticated
							const authResult = await this.authenticate(validatedMessage.payload);
							authenticated = authResult.success;
							if (authenticated) {
								username = validatedMessage.payload.username;
								connection.username = username; // Update connection object
					                           console.log(`[ShellServer][Conn ${connectionId}] Authentication successful for user: ${username}`);
								this.emitEvent(ServerEvent.AUTHENTICATED, { connectionId, username });

								// --- Create and Start Shell Instance for this Connection ---
								try {
									await this.initializeShellForConnection(connection);
								} catch (initError) {
									// initializeShellForConnection already handles disconnect on error
									authenticated = false; // Mark as not authenticated if shell fails
									console.error(`[ShellServer][Conn ${connectionId}] Error during initial shell initialization:`, initError);
									// Send auth response indicating failure if shell init failed *after* successful auth check
									// but before sending the original success response.
									await connection.send({
										id: validatedMessage.id, type: MessageType.AUTH_RESPONSE, timestamp: Date.now(),
										payload: { success: false, error: 'Shell initialization failed after authentication', sessionId: undefined, },
									});
									// disconnect is handled by initializeShellForConnection's error path
									break; // Exit case early as connection is being terminated
								}
								// --- Shell instance started ---
							}
					                       // Send Auth Response (success or failure, considering potential init failure)
							await connection.send({
								id: validatedMessage.id, type: MessageType.AUTH_RESPONSE, timestamp: Date.now(),
								payload: { success: authenticated, error: authResult.error, sessionId: authenticated ? connectionId : undefined, },
							});

							if (!authenticated && connection.connected) { // Ensure we don't try to disconnect twice
								console.log(`[ShellServer][Conn ${connectionId}] Authentication or initial setup failed, disconnecting.`);
								await connection.disconnect('Authentication failed'); // Disconnect immediately on failure
								// `disconnect` handles breaking the loop and cleanup
							}
						}
						break;
					} // End of AUTH_REQUEST case block

					case MessageType.INPUT: {
						if (!authenticated || !connection.shellInstance) {
							console.warn(`[ShellServer][Conn ${connectionId}] INPUT received but not authenticated or shell not ready.`);
							if (!authenticated) {
								await connection.send({
									id: crypto.randomUUID(), type: MessageType.ERROR, timestamp: Date.now(),
									payload: { message: 'Not authenticated', code: 'AUTH_REQUIRED' },
								});
							} else {
								await connection.send({
									id: crypto.randomUUID(), type: MessageType.ERROR, timestamp: Date.now(),
									payload: { message: 'Shell not initialized', code: 'SHELL_NOT_READY' },
								});
							}
							continue;
						}

						// validatedMessage is already confirmed to be InputMessage here by the switch
						const inputMessage = validatedMessage;
						if (typeof inputMessage.payload?.data === 'string') {
							// console.log(`[ShellServer][Conn ${connectionId}] Processing INPUT data: ${inputMessage.payload.data.substring(0, 50)}...`); // Verbose
							try {
								// Pass input data (like keystrokes or pasted text) to the connection's shell instance
								const inputDataBytes = new TextEncoder().encode(inputMessage.payload.data);
								connection.shellInstance.handleInputData(inputDataBytes);
							} catch (inputError) {
								console.error(`[ShellServer][Conn ${connectionId}] Error handling input data in shell:`, inputError);
								// Optionally send an error back to the client
								await connection.send({
									id: crypto.randomUUID(), type: MessageType.ERROR, timestamp: Date.now(),
									payload: { message: 'Error processing input', code: 'INPUT_ERROR' },
								});
							}
						} else {
							console.warn(`[ShellServer][Conn ${connectionId}] Invalid INPUT message payload:`, inputMessage.payload);
							await connection.send({
								id: crypto.randomUUID(), type: MessageType.ERROR, timestamp: Date.now(),
								payload: { message: 'Invalid input payload format', code: 'INVALID_PAYLOAD' },
							});
						}
						break;
					} // End of INPUT case block

					case MessageType.PING: {
						// console.log(`[ShellServer][Conn ${connectionId}] Received PING, sending PONG.`); // Verbose
						await connection.send({
							id: crypto.randomUUID(), type: MessageType.PONG, timestamp: Date.now(),
							payload: { uptime: Date.now() - this.startTime },
						});
						break;
					} // End of PING case block
					case MessageType.PONG: {
						// console.log(`[ShellServer][Conn ${connectionId}] Received PONG.`); // Verbose
						// Client responded to our ping, connection is alive. No action needed.
						break;
					} // End of PONG case block
					// TODO: Handle RESIZE message to update Shell dimensions
					case MessageType.RESIZE: {
						if (!authenticated || !connection.shellInstance) {
							console.warn(`[ShellServer][Conn ${connectionId}] RESIZE received but not authenticated or shell not ready.`);
							continue;
						}
						// validatedMessage is ResizeMessage here
						const { width, height } = validatedMessage.payload;
						console.log(`[ShellServer][Conn ${connectionId}] Processing RESIZE: ${width}x${height}`);
						try {
							connection.shellInstance.resize(width, height);
						} catch (resizeError) {
							console.error(`[ShellServer][Conn ${connectionId}] Error resizing shell:`, resizeError);
							// Optionally inform client
						}
						break;
					} // End of RESIZE case block
					// Explicitly ignore message types the server sends but shouldn't receive
					case MessageType.AUTH_RESPONSE:
					case MessageType.COMMAND_RESPONSE: // Potentially deprecated
					case MessageType.OUTPUT:
					case MessageType.ERROR:
					case MessageType.DISCONNECT: { // Server sends DISCONNECT
						console.warn(`[ShellServer][Conn ${connectionId}] Received unexpected message type from client: ${validatedMessage.type}. Ignoring.`);
						break;
					}
					// Handle potentially deprecated Command Request separately if needed, or group with unexpected
					case MessageType.COMMAND_REQUEST: { // Potentially deprecated
						console.warn(`[ShellServer][Conn ${connectionId}] Received deprecated COMMAND_REQUEST from client. Ignoring.`);
						// Optionally send an error response if this is strictly forbidden
						// await connection.send({ ... error message ... });
						break;
					}

					default: {
						// This should now correctly catch any *truly* unhandled future types
					                    // if the union is extended without updating the switch.
						// This should now correctly catch any *truly* unhandled future types
						// if the union is extended without updating the switch.
						const unhandled: never = validatedMessage;
						console.error(`[ShellServer][Conn ${connectionId}] FATAL: Unhandled message type in switch: ${(unhandled as ProtocolMessage).type}`);
						// Consider sending a generic error or disconnecting
						await connection.send({
							id: crypto.randomUUID(), type: MessageType.ERROR, timestamp: Date.now(),
							payload: { message: `Server error: Unhandled message type ${ (unhandled as ProtocolMessage).type }`, code: 'INTERNAL_SERVER_ERROR' },
						});
						break;
					} // End of default case block
				}
				// Moved catch block earlier to wrap JSON.parse
			}
			// If loop finishes normally (e.g., client closed connection sending EOF)
			console.log(`[ShellServer][Conn ${connectionId}] Read loop terminated normally (EOF or client closed).`);
			await connection.disconnect('Client closed connection');

		} catch (readError) {
			         // Handle errors during the read loop itself (e.g., connection reset by peer, network issue)
			if (connection.connected) { // Only handle if we didn't disconnect intentionally already
			    console.error(`[ShellServer][Conn ${connectionId}] Error during read loop:`, readError);
			    await this.handleConnectionError(connectionId, readError);
			         } else {
			             console.log(`[ShellServer][Conn ${connectionId}] Read loop terminated for already disconnected client.`);
			         }
		} finally {
			// Final cleanup, ensuring connection is removed if disconnect failed or loop exited unexpectedly
			         console.log(`[ShellServer][Conn ${connectionId}] Entering final cleanup for connection handler.`);
			if (this.connections.has(connectionId) && connection.connected) {
			             console.warn(`[ShellServer][Conn ${connectionId}] Connection handler exiting but connection still marked active. Forcing disconnect.`);
				await connection.disconnect('Connection handler cleanup');
			} else if (!this.connections.has(connectionId)) {
			             console.log(`[ShellServer][Conn ${connectionId}] Connection already removed during handler final cleanup.`);
			         } else {
			              console.log(`[ShellServer][Conn ${connectionId}] Connection handler cleanup for already disconnected client.`);
			         }
			         // Shell instance cleanup is handled within connection.disconnect()
		}
	}

			 /**
			  * Initializes and starts a new Shell instance for an authenticated connection.
			  * Sets up input/output forwarding between the connection and the shell.
			  *
			  * @param connection - The connection object for which to initialize the shell.
			  * @private
			  * @throws {Error} If shell creation or starting fails.
			  */
			 private async initializeShellForConnection(connection: Connection): Promise<void> {
			     const connectionId = connection.id;
			     console.log(`[ShellServer][Conn ${connectionId}] Initializing Shell instance...`);

			     if (connection.shellInstance) {
			         console.warn(`[ShellServer][Conn ${connectionId}] Shell instance already exists. Skipping initialization.`);
			         return;
			     }

			     try {
			         const shellInstanceForConn = new Shell({
			             name: `Remote Shell (${connection.username || connectionId.substring(0, 4)})`,
			             prompt: this.options.defaultPrompt,
			             // Initial dimensions can be undefined; client should send RESIZE later
			             width: undefined,
			             height: undefined,
			            // Pass base commands from server options to the Shell constructor
			            commands: this.options.baseCommands,
			         });
			         connection.shellInstance = shellInstanceForConn; // Store it on the connection

			         // --- Setup Output Forwarding ---
			         // Forwards shell output -> client
			         const sendOutput = (data: string) => {
			             connection.send({
			                 id: crypto.randomUUID(), type: MessageType.OUTPUT, timestamp: Date.now(),
			                 // Use connectionId as a general ID for output related to this session
			                 payload: { content: data, final: false, commandId: connectionId },
			             }).catch(err => console.error(`[ShellServer][Conn ${connectionId}] Error sending shell output:`, err));
			         };

			         // --- Setup Input Processing ---
			         // Forwards client commands -> shell execution (used by Shell.start)
			         const processInput = async (command: string) => {
			             if (connection.shellInstance) {
			                 try {
			                     // console.log(`[ShellServer][Conn ${connectionId}] Executing command in shell: ${command.substring(0,50)}...`); // Verbose
			                     const result = await connection.shellInstance.executeCommand(command); // Capture result

			      // Check if the registry/parser handled the command unsuccessfully
			      // Note: Help requests return success: true, so they won't trigger this.
			      if (!result.success && result.error) {
			       // Error message should have already been sent by the registry/parser via context.write
			       // Log it server-side for debugging.
			       console.error(`[ShellServer][Conn ${connectionId}] Command execution failed (handled by registry/parser):`, result.error.message);
			      }
			                 } catch (cmdActionError) { // Catch only errors thrown *during* command ACTION execution
			                      console.error(`[ShellServer][Conn ${connectionId}] Error during command action execution '${command.substring(0,50)}...':`, cmdActionError);
			                      // Send specific error feedback for action errors
			                      sendOutput(`\nError during command execution: ${cmdActionError instanceof Error ? cmdActionError.message : String(cmdActionError)}\n`);
			                 }
			             } else {
			                  console.error(`[ShellServer][Conn ${connectionId}] processInput called but shell instance is missing!`);
			             }
			         };

			         // --- Setup Shell Stop Listener ---
			         // Listen for the STOP event *on this specific shell instance*
			         shellInstanceForConn.on(ShellEventType.STOP, () => {
			             console.log(`[ShellServer][Conn ${connectionId}] Shell instance emitted STOP event. Disconnecting client.`);
			             // Use a non-awaited call to avoid blocking if disconnect takes time
			             connection.disconnect('Shell exited').catch(err => console.error(`[ShellServer][Conn ${connectionId}] Error during disconnect triggered by shell stop:`, err));
			         });

			         // --- Start the Shell ---
			         await shellInstanceForConn.start(processInput, sendOutput);
			         console.log(`[ShellServer][Conn ${connectionId}] Shell instance started successfully.`);
			         this.emitEvent(ServerEvent.SHELL_STARTED, { connectionId });

			     } catch (shellError) {
			         console.error(`[ShellServer][Conn ${connectionId}] Failed to initialize or start shell instance:`, shellError);
			         // Clean up partially created shell if necessary
			         connection.shellInstance = undefined;
			         // Send error to client and disconnect
			         await connection.send({
			             id: crypto.randomUUID(), type: MessageType.ERROR, timestamp: Date.now(),
			             payload: { message: `Failed to start shell session: ${shellError instanceof Error ? shellError.message : String(shellError)}`, code: 'SHELL_INIT_FAILED' },
			         });
			         await connection.disconnect('Shell initialization failed');
			         throw shellError; // Re-throw to signal failure up the chain if needed
			     }
			 }

	/**
	 * Asynchronously reads data from a connection and yields messages separated by newlines.
	 * Handles partial messages received across multiple read calls.
	 *
	 * @param conn - The Deno connection to read from.
	 * @yields {string} Each complete message string (terminated by newline).
	 * @private
	    * @generator
	 */
	private async *readLines(conn: Deno.Conn): AsyncGenerator<string> {
		
        const buf = new Uint8Array(4096); // Increased buffer size for potentially larger messages
 
  let leftover = '';

  while (true) {
            let n: number | null;
            try {
       n = await conn.read(buf);
            } catch (readErr) {
                // Check for specific error types if needed (e.g., BadResource)
                // If it's a BadResource error, the connection is likely closed.
                if (readErr instanceof Deno.errors.BadResource) {
                    console.log(`[ShellServer][readLines] Read failed (BadResource), connection likely closed.`);
                } else {
                    console.error(`[ShellServer][readLines] Read error:`, readErr);
                }
                break; // Exit loop on read error
            }

   if (n === null) {
    // console.log(`[ShellServer][readLines] Read returned null (EOF), ending loop.`); // Verbose
    break; // EOF reached, connection closed by peer
   }
            if (n === 0) {
                // Should not happen with TCP, but handle defensively
                console.warn("[ShellServer][readLines] Read 0 bytes, potentially busy-waiting. Check logic.");
                await new Promise(resolve => setTimeout(resolve, 50)); // Small delay
                continue;
            }

   const chunk = new TextDecoder().decode(buf.subarray(0, n));
   // console.log(`[ShellServer][readLines] Read ${n} bytes: "${chunk.substring(0,50)}..."`); // Verbose
   leftover += chunk; // Append new chunk to leftover data

   let newlineIndex;
   // Process all complete lines found in the buffer
   while ((newlineIndex = leftover.indexOf('\n')) >= 0) {
    const line = leftover.slice(0, newlineIndex);
    leftover = leftover.slice(newlineIndex + 1); // Update leftover
    if (line.trim()) { // Ignore empty lines (e.g., double newlines)
     // console.log(`[ShellServer][readLines] Yielding line: ${line.substring(0,100)}...`); // Verbose
     yield line;
    }
   }
            // After the loop, 'leftover' contains any partial line data
  }

  // After the read loop finishes (EOF or error), yield any remaining data
  if (leftover.trim()) {
   console.log(`[ShellServer][readLines] Yielding final leftover data: ${leftover.substring(0, 100)}${leftover.length > 100 ? '...' : ''}`);
   yield leftover;
  }
  console.log(`[ShellServer][readLines] Exiting generator.`);
	}

	/**
	 * Authenticates a client connection attempt based on the server's configured authentication method.
	 * Supports `NONE`, `BASIC` (username/password hash), and `TOKEN` (custom validator).
	 *
	 * @param payload - The authentication request payload from the client.
	 * @returns A promise resolving to an object indicating authentication success or failure (with an optional error message).
	 * @private
	 */
	private async authenticate(payload: {
		authType: AuthType;
		username?: string;
		password?: string;
		token?: string;
	}): Promise<{ success: boolean; error?: string }> {
		   console.log(`[ShellServer] Authenticating connection... AuthType provided by client: ${payload.authType}`);
  const serverAuthOptions = this.options.auth;
  const serverAuthType = serverAuthOptions?.type || AuthType.NONE;

  if (payload.authType !== serverAuthType) {
   console.warn(`[ShellServer] Authentication failed: Type mismatch. Server requires ${serverAuthType}, Client sent ${payload.authType}`);
   return { success: false, error: `Authentication type mismatch. Server expects ${serverAuthType}, got ${payload.authType}`};
  }

  switch (serverAuthType) {
            case AuthType.NONE: {
                console.log(`[ShellServer] Authentication successful (AuthType: NONE).`);
                return { success: true };
            }
            case AuthType.BASIC: {
                console.log(`[ShellServer] Attempting Basic authentication for user: ${payload.username}`);
                if (!payload.username || !payload.password) {
                    console.warn('[ShellServer] Basic Auth failed: Username or password missing.');
                    return { success: false, error: 'Username and password are required for basic authentication' };
                }
                if (!serverAuthOptions?.users || serverAuthOptions.users.length === 0) {
                    console.error('[ShellServer] Basic Auth failed: No users configured on the server.');
                    return { success: false, error: 'Server user list is empty or not configured' };
                }

                const user = serverAuthOptions.users.find(u => u.username === payload.username);
                if (!user) {
                    console.warn(`[ShellServer] Basic Auth failed: User ${payload.username} not found.`);
                    return { success: false, error: 'User not found' };
                }

                console.log(`[ShellServer] Found user: ${user.username}. Verifying password...`);
                try {
                    const providedPasswordHash = await this.hashPassword(payload.password);
                    if (user.passwordHash === providedPasswordHash) {
                        console.log(`[ShellServer] Basic Auth successful for user: ${user.username}`);
                        return { success: true };
                    } else {
                        console.warn(`[ShellServer] Basic Auth failed for user ${user.username}: Invalid password.`);
                        return { success: false, error: 'Invalid password' };
                    }
                } catch (hashError) {
                     console.error(`[ShellServer] Error hashing password during basic auth for ${user.username}:`, hashError);
                     return { success: false, error: 'Internal error during password verification' };
                }
            } // End of BASIC case block
            case AuthType.TOKEN: {
                console.log(`[ShellServer] Attempting Token authentication.`);
                if (!payload.token) {
                    console.warn('[ShellServer] Token Auth failed: Token missing.');
                    return { success: false, error: 'Token is required for token authentication' };
                }
                if (!serverAuthOptions?.tokenValidator) {
                    console.error('[ShellServer] Token Auth failed: No token validator configured on the server.');
                    return { success: false, error: 'No token validator configured on the server' };
                }

                try {
                    console.log(`[ShellServer] Validating token...`);
                    const isValid = await serverAuthOptions.tokenValidator(payload.token);
                    console.log(`[ShellServer] Token validation result: ${isValid}`);
                    return isValid ? { success: true } : { success: false, error: 'Invalid token' };
                } catch (error) {
                    console.error('[ShellServer] Token validator function threw an error:', error);
                    return { success: false, error: `Token validation error: ${error instanceof Error ? error.message : String(error)}` };
                }
            } // End of TOKEN case block
            default:{
                 // Should be unreachable due to initial type check, but good practice
                 const exhaustiveCheck: never = serverAuthType;
                 console.error(`[ShellServer] Authentication failed: Unsupported auth type encountered: ${exhaustiveCheck}.`);
                 return { success: false, error: `Unsupported authentication type configured: ${exhaustiveCheck}` };
        }} // End of switch
	}

	/**
	 * Hashes a password using SHA-256 for basic authentication storage and comparison.
	 * This is a simple example; consider using a more robust library like bcrypt
	 * with salts for production environments.
	 *
	 * @param password - The plain text password to hash.
	 * @returns A promise resolving to the hexadecimal representation of the SHA-256 hash.
	 * @public // Marked public for potential use in setting up auth options (e.g., in examples).
	 */
	public async hashPassword(password: string): Promise<string> { 
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  // Convert each byte to a 2-digit hex string
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
   return hashHex;
	}

	/**
	 * Handles errors that occur on a specific connection (e.g., read/write errors, timeouts).
	 * Emits an `ERROR` event and triggers the disconnection process for the affected client.
	 *
	 * @param connectionId - The ID of the connection where the error occurred.
	 * @param error - The error object or value.
	 * @private
	 */
	private async handleConnectionError(
		connectionId: string,
		error: unknown,
	): Promise<void> {
        const errorMsg = error instanceof Error ? error.message : String(error);
  // Avoid logging excessively for common disconnect errors like 'connection reset by peer'
        const isCommonDisconnect = errorMsg.includes('Connection reset by peer') || errorMsg.includes('Broken pipe');
        if (!isCommonDisconnect) {
      console.error(`[ShellServer][Conn ${connectionId}] Connection error:`, errorMsg, error); // Log full error for uncommon cases
        } else {
            console.log(`[ShellServer][Conn ${connectionId}] Connection closed by peer:`, errorMsg);
        }

  const connection = this.connections.get(connectionId);
  if (connection && connection.connected) { // Check if connection exists and is marked as connected
   console.log(`[ShellServer][Conn ${connectionId}] Emitting ERROR event and disconnecting due to error.`);
   this.emitEvent(ServerEvent.ERROR, { connectionId, error: errorMsg });
   // Disconnect should handle shell stop and removal from map
   await connection.disconnect(`Connection error: ${errorMsg}`);
  } else if (connection && !connection.connected) {
            console.log(`[ShellServer][Conn ${connectionId}] Connection error occurred, but connection was already marked as disconnected.`);
        } else {
   console.warn(`[ShellServer][Conn ${connectionId}] Connection error occurred for a connection no longer in the map.`);
  }
	}

	/**
	 * Starts a periodic interval timer that sends PING messages to all connected clients.
	 * If a client doesn't respond (tracked via `lastActivity`), it's considered timed out
	 * and disconnected.
	 * Clears any existing interval before starting a new one.
	 *
	 * @private
	 */
	private startPingInterval(): void {
        console.log(`[ShellServer] Starting ping interval (${this.options.pingInterval}ms).`);
		if (this.pingIntervalId) {
			clearInterval(this.pingIntervalId);
			console.log('[ShellServer] Cleared existing ping interval.');
		          this.pingIntervalId = undefined;
		}

		this.pingIntervalId = setInterval(async () => {
			const now = Date.now();
		          const timeoutThreshold = this.options.pingInterval! * 2; // Time after which to consider timeout
			// console.log(`[ShellServer] Running ping check. Connections: ${this.connections.size}`); // Verbose

		          // Use Promise.all to handle pings and timeouts concurrently
		          const checks = Array.from(this.connections.values()).map(async (connection) => {
		              if (!connection.connected) return; // Skip disconnected ones

		              if (now - connection.lastActivity > timeoutThreshold) {
					console.warn(`[ShellServer][Conn ${connection.id}] Connection timed out (no activity for > ${timeoutThreshold}ms). Disconnecting.`);
					await connection.disconnect('Connection timeout'); // Await disconnect here
					return; // Don't try to ping a timed-out connection
				}

		              // Send PING
		              try {
		                  // console.log(`[ShellServer][Conn ${connection.id}] Sending PING.`); // Verbose
				    await connection.send({
					    id: crypto.randomUUID(), type: MessageType.PING, timestamp: now,
				    });
		              } catch (pingError) {
		                  // Error sending ping likely means connection is already broken
					console.error(`[ShellServer][Conn ${connection.id}] Failed to send PING. Disconnecting. Error:`, pingError);
					await connection.disconnect('Failed to send ping'); // Await disconnect here
		              }
		          });

		          try {
		              await Promise.all(checks);
		          } catch (intervalError) {
		              // Should ideally not happen if individual errors are caught, but good practice
		              console.error("[ShellServer] Error during ping interval execution:", intervalError);
		          }

		}, this.options.pingInterval);
		      // Make sure the interval doesn't prevent Deno from exiting if it's the only thing running
		      // Deno.unrefTimer(this.pingIntervalId); // Consider if this is desired behavior
	}

	/**
	 * Stops the shell server gracefully.
	 * Closes the listening socket, disconnects all clients, clears intervals,
	 * and removes the Unix socket file if applicable.
	 *
	 * @returns A promise that resolves when the server has fully stopped.
	 */
	public async stop(): Promise<void> {
        console.log('[ShellServer] Stopping server...');
		if (!this.isRunning) {
			console.warn('[ShellServer] Stop called but server is not running.');
			return;
		}
		this.isRunning = false; // Mark as not running immediately

		// 1. Clear the ping interval
		if (this.pingIntervalId) {
			console.log('[ShellServer] Clearing ping interval.');
			clearInterval(this.pingIntervalId);
			this.pingIntervalId = undefined;
		}

		// 2. Stop accepting new connections by closing the listener
		if (this.server) {
			console.log('[ShellServer] Closing server listener...');
			try {
			    this.server.close();
		              console.log('[ShellServer] Server listener closed.');
		          } catch (closeErr) {
		              console.error('[ShellServer] Error closing server listener:', closeErr);
		          } finally {
			    this.server = undefined;
		          }
		}

		// 3. Disconnect all existing clients
		console.log('[ShellServer] Disconnecting all clients...');
		await this.disconnectAll(); // disconnectAll now handles shell stop

		// 4. Clean up Unix socket file if used
		if (this.options.socketPath) {
			console.log(`[ShellServer] Attempting to remove Unix socket file: ${this.options.socketPath}`);
			try {
				await Deno.remove(this.options.socketPath);
				console.log(`[ShellServer] Removed Unix socket file: ${this.options.socketPath}`);
			} catch (removeErr) {
		              // Ignore 'NotFound' errors, warn about others
		              if (!(removeErr instanceof Deno.errors.NotFound)) {
				    console.warn(`[ShellServer] Failed to remove Unix socket file:`, removeErr);
		              } else {
		                   console.log(`[ShellServer] Unix socket file already removed or never existed: ${this.options.socketPath}`);
		              }
			}
		}
		console.log('[ShellServer] Server stopped.');
	}

	/**
	 * Disconnects all currently connected clients.
	 * Sends a disconnect message and closes each connection.
	 * Stops the associated Shell instance for each connection.
	 *
	 * @returns A promise that resolves when all disconnect operations have been initiated.
	 */
	public async disconnectAll(): Promise<void> {
        const connectionIds = Array.from(this.connections.keys()); // Get IDs before iterating
        console.log(`[ShellServer] Disconnecting ${connectionIds.length} client(s)...`);
        if (connectionIds.length === 0) {
            return; // Nothing to do
        }

        const disconnectPromises: Promise<void>[] = [];

  for (const connectionId of connectionIds) {
            const connection = this.connections.get(connectionId);
   if (connection && connection.connected) { // Check if still connected
                console.log(`[ShellServer][Conn ${connection.id}] Initiating disconnect (Server shutting down).`);
       // `disconnect` handles shell stop, sending message, closing conn, and removing from map
                disconnectPromises.push(
        connection.disconnect('Server shutting down').catch((err) => {
        	// Log error but don't let one failed disconnect stop others
                        console.error(`[ShellServer][Conn ${connection.id}] Error during disconnectAll disconnect (ignored):`, err);
        }),
       );
            } else if (connection && !connection.connected) {
                 console.log(`[ShellServer][Conn ${connectionId}] Already disconnected, skipping in disconnectAll.`);
            } else {
                 console.warn(`[ShellServer][Conn ${connectionId}] Not found in map during disconnectAll, skipping.`);
            }
  }

        // Wait for all disconnect operations to settle (complete or fail)
  await Promise.allSettled(disconnectPromises); // Use allSettled to ensure all attempts complete

  console.log(`[ShellServer] All disconnect attempts finished.`);
        if (this.connections.size > 0) {
             // This indicates a potential issue in the disconnect logic if connections remain
             console.warn(`[ShellServer] Connections map not empty after disconnectAll (${this.connections.size} remaining). This might indicate an issue.`);
             // Consider force clearing as a fallback, though ideally disconnect should handle it
             // this.connections.clear();
        }
  console.log(`[ShellServer] DisconnectAll complete.`);
	}

	/**
	 * Retrieves a list of all currently active connections.
	 * Note: The returned `Connection` objects contain references to live Shell instances.
	 *
	 * @returns An array of `Connection` objects representing the active connections.
	 */
	public getConnections(): Connection[] {
  return Array.from(this.connections.values());
	}

	/**
	 * Registers an event handler for a specific server event.
	 *
	 * @param event - The `ServerEvent` to listen for.
	 * @param handler - The callback function to execute when the event is emitted.
	 *                  The handler receives the event-specific payload as an argument.
	 */
	public on(event: ServerEvent, handler: (payload: unknown) => void): void {

	      
		this.eventEmitter.on(event, handler);
	}

	/**
	 * Unregisters a previously registered event handler for a specific server event.
	 *
	 * @param event - The `ServerEvent` to stop listening to.
	 * @param handler - The specific callback function to remove. Must be the same function reference
	 *                  used when calling `on`.
	 */
	public off(event: ServerEvent, handler: (payload: unknown) => void): void { 
		this.eventEmitter.off(event, handler);
	}

	/**
	 * Emits a server event with an associated payload to all registered listeners.
	 *
	 * @param event - The `ServerEvent` to emit.
	 * @param payload - The data associated with the event.
	 * @private
	 */
	private emitEvent(event: ServerEvent, payload: unknown): void {

		      try {
		          const payloadSummary = JSON.stringify(payload)?.substring(0, 100) || String(payload);
		          console.log(`[ShellServer] Emitting event: ${event}. Payload summary: ${payloadSummary}${payloadSummary.length === 100 ? '...' : ''}`); // Log summary
		    this.eventEmitter.emit(event, payload);
		      } catch (emitError) {
		          // Prevent errors in event handlers from crashing the server
		          console.error(`[ShellServer] Error occurred within an event handler for '${event}':`, emitError);
		      }
	}
}
