// src/remote/InteractiveClient.ts
import { ShellClient, type ShellClientOptions } from './client.ts';
import { ClientEvent } from './protocol.ts';
import { EventEmitter } from 'node:events';

/**
 * Options specifically for the InteractiveShellClient wrapper.
 * Inherits ShellClientOptions.
 */
export interface InteractiveShellClientOptions extends ShellClientOptions {
	// Add any interactive-specific options here in the future if needed
}

/**
 * A wrapper around {@link ShellClient} designed to simplify the setup of an
 * interactive terminal session. It automatically handles terminal raw mode
 * switching and pipes standard input/output (stdin/stdout) between the local
 * terminal and the remote shell process.
 *
 * This class emits the core {@link ClientEvent}s (`CONNECT`, `DISCONNECT`, `ERROR`)
 * forwarded from the underlying `ShellClient`.
 *
 * @example
 * ```typescript
 * import { InteractiveShellClient } from "./InteractiveClient.ts";
 *
 * const client = new InteractiveShellClient({ url: "ws://localhost:8080" });
 *
 * client.on(ClientEvent.CONNECT, () => console.log("Connected!"));
 * client.on(ClientEvent.DISCONNECT, ({ code, reason }) => {
 *   console.log(`Disconnected: ${reason} (Code: ${code})`);
 *   Deno.exit(code === 1000 ? 0 : 1); // Exit cleanly on normal disconnect
 * });
 * client.on(ClientEvent.ERROR, ({ message, error }) => console.error(`Error: ${message}`, error));
 *
 * try {
 *   await client.start();
 *   console.log("Interactive session started. Press Ctrl+C to exit.");
 * } catch (error) {
 *   console.error("Failed to start interactive session:", error);
 *   Deno.exit(1);
 * }
 * ```
 *
 * @extends EventEmitter
 */
export class InteractiveShellClient extends EventEmitter {
	/** @internal The underlying ShellClient instance. */
	private shellClient: ShellClient;
	/** @internal Configuration options for the client. */
	private options: InteractiveShellClientOptions;
	/** @internal Promise tracking the stdin reading loop. */
	private stdinReadLoopPromise: Promise<void> | undefined;
	/** @internal Promise tracking the stdout writing loop. */
	private stdoutWriteLoopPromise: Promise<void> | undefined;
	/** @internal Tracks the current state of terminal raw mode. */
	private isRawMode = false;
	/** @internal Flag to prevent starting stdio pipes multiple times on reconnect. */
	   private pipingStarted = false;

	/**
	 * Creates an instance of InteractiveShellClient.
	 * @param options - Configuration options for the interactive client, extending {@link ShellClientOptions}.
	 */
	constructor(options: InteractiveShellClientOptions) {
		super();
		this.options = options;
		this.shellClient = new ShellClient(options);
		this.setupEventForwarding();
		this.setupCleanupListeners();
	}

	/**
	    * @internal
	    * Sets up forwarding for essential events from the underlying {@link ShellClient}.
	    * This includes `CONNECT`, `DISCONNECT`, and `ERROR`.
	    * `OUTPUT` is typically handled via direct stdout piping.
	    */
	private setupEventForwarding(): void {
		this.shellClient.on(ClientEvent.CONNECT, (payload) => this.emit(ClientEvent.CONNECT, payload));
		this.shellClient.on(ClientEvent.DISCONNECT, (payload) => {
            this.pipingStarted = false; // Reset flag on disconnect
            this.emit(ClientEvent.DISCONNECT, payload);
        });
		this.shellClient.on(ClientEvent.ERROR, (payload) => this.emit(ClientEvent.ERROR, payload));
		// Note: OUTPUT is handled by piping, but could be forwarded if needed:
		// this.shellClient.on(ClientEvent.OUTPUT, (payload) => this.emit(ClientEvent.OUTPUT, payload));
	}

	/**
	    * @internal
	    * Sets up global listeners to ensure proper cleanup, specifically disabling
	    * raw mode on process exit (`unload`) and handling interrupt signals (`SIGINT`)
	    * for graceful disconnection.
	    */
	private setupCleanupListeners(): void {
		// Ensure raw mode is disabled on unexpected exit
		globalThis.addEventListener("unload", () => {
			this.disableRawMode();
		});

        // Handle Ctrl+C
        try { // Deno.addSignalListener might not be available in all envs
            Deno.addSignalListener("SIGINT", async () => {
                // console.log("\n[InteractiveClient] SIGINT received, disconnecting...");
                await this.stop();
                // Ensure process exits after cleanup if not handled by disconnect event
                setTimeout(() => Deno.exit(0), 50);
            });
        } catch (e) {
            if (e instanceof Deno.errors.PermissionDenied) {
                 console.warn("[InteractiveClient] Permission denied for SIGINT listener. Ctrl+C might not disconnect cleanly.");
            } else {
                 console.warn("[InteractiveClient] SIGINT listener setup failed:", e);
            }
        }
	}

	/**
	    * @internal
	    * Enables terminal raw mode for `Deno.stdin`.
	    * Raw mode allows capturing individual keystrokes (like Ctrl+C) instead of line-buffered input.
	    * @returns `true` if raw mode was enabled successfully or was already enabled, `false` otherwise.
	    */
	private enableRawMode(): boolean {
		if (this.isRawMode) return true;
		try {
			Deno.stdin.setRaw(true);
			this.isRawMode = true;
			// console.log('[InteractiveClient] Raw mode enabled.');
			return true;
		} catch (e) {
			console.error('[InteractiveClient] Failed to enable raw mode:', e);
			this.emit(ClientEvent.ERROR, { message: "Failed to enable raw mode", error: e });
			return false;
		}
	}

	/**
	    * @internal
	    * Disables terminal raw mode for `Deno.stdin` if it's currently enabled and stdin is a TTY.
	    * This restores normal terminal input behavior.
	    */
	private disableRawMode(): void {
		if (!this.isRawMode) return;
		try {
            // Check if stdin is still a TTY before disabling raw mode
            // This prevents errors if the process is detaching or stdin is closed
            if (Deno.stdin.isTerminal()) {
			    Deno.stdin.setRaw(false);
			    // console.log('[InteractiveClient] Raw mode disabled.');
            } else {
                 // console.log('[InteractiveClient] Stdin is not a TTY, skipping raw mode disable.');
            }
            this.isRawMode = false;
		} catch (e) {
			console.warn('[InteractiveClient] Failed to disable raw mode:', e);
			// Don't emit error here, as it usually happens during shutdown/disconnect
		}
	}

	/**
	    * @internal
	    * Starts an asynchronous loop to read data from `Deno.stdin` and write it
	    * to the {@link ShellClient}'s input stream.
	    * This loop continues as long as the client {@link isConnected}.
	    * It handles stdin closure and read/write errors.
	    */
	private startStdinPiping(): void {
        if (this.pipingStarted) return; // Prevent multiple starts
		const inputStream = this.shellClient.getInputStream();
		const writer = inputStream.getWriter();
		const decoder = new TextDecoder();
		this.stdinReadLoopPromise = (async () => {
			// console.log('[InteractiveClient] Starting stdin read loop...');
			const buffer = new Uint8Array(1024);
			// Use the getter to check connection status
			while (this.isConnected) {
				try {
					const n = await Deno.stdin.read(buffer);
					if (n === null) { // Stdin closed
						// console.log('[InteractiveClient] Stdin closed.');
						try { await writer.close(); } catch { /* ignore */ }
						break;
					}
					const dataString = decoder.decode(buffer.subarray(0, n));
					await writer.write(dataString);
				} catch (err) {
					console.error('[InteractiveClient] Error reading/writing stdin:', err);
                    // Use the getter to check connection status
                    if (this.isConnected) { // Avoid errors after disconnect
					    try { await writer.abort(err); } catch { /* ignore */ }
                    }
					break;
				}
			}
			// console.log('[InteractiveClient] Exiting stdin read loop.');
		})().catch(err => {
            console.error("Stdin processing loop error:", err);
            // Consider triggering disconnect if stdin piping fails critically
            // this.stop().catch(...)
        });
	}

	/**
	    * @internal
	    * Starts an asynchronous loop to read data from the {@link ShellClient}'s output
	    * stream and write it to `Deno.stdout`.
	    * This loop continues as long as the client {@link isConnected}.
	    * It handles stream closure and read/write errors.
	    */
	private startStdoutPiping(): void {
        if (this.pipingStarted) return; // Prevent multiple starts
		const outputStream = this.shellClient.getOutputStream();
		const reader = outputStream.getReader();
		const encoder = new TextEncoder();
		this.stdoutWriteLoopPromise = (async () => {
			// console.log('[InteractiveClient] Starting stdout write loop...');
            // Use the getter to check connection status
			while(this.isConnected) {
				try {
					const { value, done } = await reader.read();
					if (done) {
						// console.log('[InteractiveClient] Client output stream closed.');
						break;
					}
					if (value) {
						await Deno.stdout.write(encoder.encode(value));
					}
				} catch (err) {
					console.error('[InteractiveClient] Error reading client output or writing stdout:', err);
                    // Use the getter to check connection status
                    if (!this.isConnected) break; // Break if already disconnected
                    // Avoid breaking the loop for stdout write errors if possible
				}
			}
			// console.log('[InteractiveClient] Exiting stdout write loop.');
		})().catch(err => console.error("Stdout processing loop error:", err));
	}

	/**
	 * Initiates the connection to the remote shell server and starts the
	 * interactive session.
	 *
	 * On successful connection (`CONNECT` event), it enables terminal raw mode
	 * and starts piping stdin and stdout.
	 * On disconnection (`DISCONNECT` event), it disables raw mode.
	 *
	 * @returns A promise that resolves when the connection attempt is initiated.
	 *          It may reject if the initial connection fails immediately.
	 * @throws Re-throws errors encountered during the initial connection attempt.
	 */
	public async start(): Promise<void> {
		// Use 'on' instead of 'once'
		this.shellClient.on(ClientEvent.CONNECT, () => {
            // Prevent starting pipes multiple times on potential reconnects
            if (!this.pipingStarted) {
                 if (!this.enableRawMode()) {
                    this.stop().catch(err => console.error("Error stopping client after raw mode fail:", err));
                    return;
                 }
			    this.startStdinPiping();
			    this.startStdoutPiping();
                this.pipingStarted = true;
            }
		});

        // Use 'on' instead of 'once'
		this.shellClient.on(ClientEvent.DISCONNECT, () => {
			this.disableRawMode();
            this.pipingStarted = false; // Ready for potential reconnect
            // Let the emitter forward the event, calling script might want to exit
		});

		// console.log('[InteractiveClient] Connecting...');
		try {
			await this.shellClient.connect();
			// console.log('[InteractiveClient] Connection process initiated.');
		} catch (error) {
			console.error('[InteractiveClient] Connection failed:', error);
            this.disableRawMode(); // Ensure cleanup on connection failure
			throw error; // Re-throw for the caller
		}
	}

	/**
	 * Gracefully stops the interactive session.
	 * This involves disabling raw mode, closing the input stream to the server,
	 * disconnecting the underlying {@link ShellClient}, and waiting briefly for
	 * the stdin/stdout piping loops to finish.
	 *
	 * @returns A promise that resolves when the stop process is complete.
	 */
	public async stop(): Promise<void> {
        // console.log('[InteractiveClient] Stopping...');
		this.disableRawMode(); // Disable raw mode first
		try {
			// Close the input stream writer *before* disconnecting client
            // This signals the end to the stdin piping loop
            const writer = this.shellClient.getInputStream().getWriter();
            try { await writer.close(); } catch { /* ignore */ }
            writer.releaseLock();

			await this.shellClient.disconnect(); // Disconnect internal client
		} catch (error) {
			console.warn('[InteractiveClient] Error during disconnect:', error);
		}
        // Wait briefly for piping loops to potentially finish after disconnect signal
        await Promise.allSettled([this.stdinReadLoopPromise, this.stdoutWriteLoopPromise]);
        // console.log('[InteractiveClient] Stopped.');
	}

    /**
     * Provides access to the underlying {@link ShellClient} instance for advanced use cases.
     * @returns The internal `ShellClient` instance.
     */
    public get internalClient(): ShellClient {
        return this.shellClient;
    }

    /**
     * Checks if the underlying {@link ShellClient} is currently connected to the server.
     * @returns `true` if connected, `false` otherwise.
     */
    public get isConnected(): boolean {
        // Use the getter from ShellClient
        return this.shellClient.isConnected;
    }
}