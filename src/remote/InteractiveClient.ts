// src/remote/InteractiveClient.ts
import { ShellClient, ShellClientOptions } from './client.ts';
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
 * A wrapper around ShellClient to simplify setting up an interactive
 * terminal session by handling raw mode and stdio piping automatically.
 */
export class InteractiveShellClient extends EventEmitter {
	private shellClient: ShellClient;
	private options: InteractiveShellClientOptions;
	private stdinReadLoopPromise: Promise<void> | undefined;
	private stdoutWriteLoopPromise: Promise<void> | undefined;
	private isRawMode = false; // Track raw mode state
    private pipingStarted = false; // Flag to prevent starting pipes multiple times on reconnect

	constructor(options: InteractiveShellClientOptions) {
		super();
		this.options = options;
		this.shellClient = new ShellClient(options);
		this.setupEventForwarding();
		this.setupCleanupListeners();
	}

	/** Sets up forwarding for core ShellClient events */
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

	/** Sets up global listeners for process exit/signals */
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

	/** Enables terminal raw mode */
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

	/** Disables terminal raw mode */
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

	/** Starts piping Deno.stdin to the ShellClient input stream */
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

	/** Starts piping the ShellClient output stream to Deno.stdout */
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
	 * Connects to the server and starts the interactive session.
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
	 * Gracefully stops the interactive session and disconnects the client.
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

    /** Accessor for the internal ShellClient if needed */
    public get internalClient(): ShellClient {
        return this.shellClient;
    }

    /** Check connection status using the new getter */
    public get isConnected(): boolean {
        // Use the getter from ShellClient
        return this.shellClient.isConnected;
    }
}