/**
 * Shell class - Core shell implementation with instance-based command system
 */
import * as colors from '../colors.ts';
import type { Command, CommandContext, CommandResult } from '../commands/types.ts'; 
import { CommandRegistry } from '../commands/Registry.ts'; 
import type { ParsedArguments } from '../commands/parser.ts'; 
import { LayoutManager } from '../ui/layout/layout_manager.ts';
import type { EventHandler, OutputFormat, OutputOptions, ShellEvent, ShellOptions } from './types.ts';
import {  ShellEventType } from './types.ts';

/**
 * Core Shell class for terminal interfaces
 */
export class Shell {
	// --- Properties ---
	private name: string;
	private prompt: string;
	private layout: LayoutManager; // Still potentially useful for state/formatting
	private commandRegistry: CommandRegistry;
	private isRunning = false; // Tracks if the shell is active
	public buffer = ''; // Public for potential external access
	private processInputCallback: ((command: string) => Promise<void>) | null = null; // Callback for processing completed command line
	private sendOutputCallback: ((data: string) => void) | null = null; // Callback to send output data remotely
	private cursorPosition = 0;
	private history: string[] = [];
	private historyIndex = -1;
	private tempBuffer = '';
	private readonly decoder = new TextDecoder();
	private readonly eventHandlers = new Map<ShellEventType, Set<EventHandler>>();

	// Key codes (for handleInputData)
	private readonly UP_ARROW = 'A';
	private readonly DOWN_ARROW = 'B';
	private readonly RIGHT_ARROW = 'C';
	private readonly LEFT_ARROW = 'D';
	private readonly TAB = 9;
	private readonly CTRL_C = ''; // Typically corresponds to ETX (End of Text), char code 3
	private readonly PAGE_UP = '5~';
	private readonly PAGE_DOWN = '6~';

	// --- Initialization ---
	/**
	 * Create a new shell instance
	 * @param options - Configuration options for the shell
	 */
	constructor(options: ShellOptions = {} as ShellOptions) { // Cast default to ShellOptions
		// Set shell properties from options with defaults
		this.name = options.name ?? 'Terminal Shell';
		this.prompt = options.prompt ?? '> ';

		// Initialize layout manager
		this.layout = new LayoutManager();

		// Update layout dimensions if provided
		if (options.width !== undefined && options.height !== undefined) {
			this.resize(options.width, options.height);
		}

		// Initialize command registry with initial commands
		this.commandRegistry = new CommandRegistry(options.commands ?? []);

		// Register built-in commands
		this.registerBuiltInCommands();
	}

	/**
	 * Register built-in shell commands
	 */
	private registerBuiltInCommands(): void {
		// Clear command
		this.commandRegistry.registerCommand({
			// deno-lint-ignore require-await
			name: 'clear',
			description: 'Clear the terminal screen',
			action: () => this.clear(),
		});

		// Help command
		this.commandRegistry.registerCommand({
			// deno-lint-ignore require-await
			name: 'help',
			description: 'Show available commands or help for a specific command.',
			// Action now accepts parsed args
			action: (context: CommandContext, parsedArgs: ParsedArguments) => {
				if (parsedArgs.positional.length > 0) {
					const commandPath = parsedArgs.positional.join(' '); // Join potential subcommand path parts
					// Attempt to find the command/subcommand in the registry
					const command = this.commandRegistry.getCommand(commandPath) || this.commandRegistry.getSubcommand(commandPath); // Assuming getSubcommand handles full paths

					if (command) {
						// TODO: Call a method on commandRegistry to get generated help for 'command'
						// const helpText = this.commandRegistry.getCommandHelp(commandPath); // Placeholder
						// context.write(helpText || `Help not available for "${commandPath}".\n`);
						context.write(`Help requested for specific command: ${commandPath} (Registry method not yet implemented).\n`);
					} else {
						context.write(`Unknown command: "${commandPath}". Use 'help' for a list.\n`, { format: 'error' });
					}
				} else {
					// No specific command requested, show general help
					this.showHelp();
				}
			},
		});

		// Exit command
		this.commandRegistry.registerCommand({
			// deno-lint-ignore require-await
			name: 'exit',
			description: 'Exit the shell',
			action: () => this.stop(), // stop() will signal the server to disconnect
		});
	}

	// --- Lifecycle & Control ---
	/**
	 * Start the shell
	 * Sets up callbacks for remote I/O.
	 * @param processInputCommand Function to call when a line of input is ready.
	 * @param sendOutput Function to call to send output data to the client.
	 */
	public async start(
		processInputCommand: (command: string) => Promise<void>,
		sendOutput: (data: string) => void,
	): Promise<void> {
		if (this.isRunning) return; // Prevent multiple starts

		this.processInputCallback = processInputCommand;
		this.sendOutputCallback = sendOutput;
		this.isRunning = true; // Mark as running conceptually

		// Emit start event
		this.emitEvent({
			type: ShellEventType.START,
			timestamp: Date.now(),
		});

		// Initial setup for the remote client
		this.clear(); // Send clear screen code
		this.displayWelcome(); // Send welcome message and initial prompt
	}

	/**
	 * Stop the shell
	 */
	public async stop(): Promise<void> {
		if (!this.isRunning) return;
		this.isRunning = false;

		// Send termination message before clearing callbacks
		this._sendOutput('\n' + colors.formatSuccess('Shell terminated.') + '\n');

		this.processInputCallback = null; // Clear callbacks
		this.sendOutputCallback = null;

		// Emit stop event
		this.emitEvent({
			type: ShellEventType.STOP,
			timestamp: Date.now(),
		});
		// No need to restore Deno.stdin raw mode
	}

	/**
	 * Resizes the internal layout manager (if still used for state).
	 * Sends clear/redraw signals if necessary.
	 * @param width The new width.
	 * @param height The new height.
	 */
	public resize(width: number, height: number): void {
		this.layout.updateTerminalSize(width, height);
		// Re-render the prompt and current input after resize
		this.clear(); // Simplest way to redraw cleanly
	}

	// --- Output Handling ---
	/**
	 * Write content to the shell output stream (via callback)
	 * @param content - Content to write
	 * @param options - Output options for formatting
	 */
	public write(content: string, options: OutputOptions = {}): void {
		let formattedContent = content;
		if (options.format) {
			formattedContent = this.formatOutput(content, options.format);
		}

		if (options.newline !== false) {
			formattedContent += '\n';
		}

		this._sendOutput(formattedContent);
	}

	/**
	 * Internal helper to send output via the configured callback.
	 * Handles the case where the callback might not be set.
	 * @param data The string data to send.
	 */
	private _sendOutput(data: string): void {
		if (this.sendOutputCallback) {
			try {
				this.sendOutputCallback(data);
			} catch (error) {
				console.error("[Shell] Error sending output:", error);
				// Potentially emit an error event or try to stop gracefully
			}
		} else {
			// Log locally if no remote callback is set (e.g., during setup/teardown)
			// console.log("[Shell Output - No Callback]:", data);
		}
	}


	/**
	 * Format output based on specified format
	 */
	private formatOutput(content: string, format: OutputFormat): string {
		switch (format) {
			case 'success': return colors.formatSuccess(content);
			case 'error': return colors.formatError('Error', content);
			case 'info': return colors.formatInfo(content);
			case 'warning': return colors.formatWarning(content);
			case 'header': return colors.header(content);
			default: return content;
		}
	}

	/**
	 * Clear the remote terminal screen
	 */
	public clear(): void {
		// Send ANSI clear screen code and move cursor to home
		this._sendOutput('\x1b[2J\x1b[H');
		this.showPrompt(); // Redraw prompt after clearing
	}

	/**
	 * Display welcome message
	 */
	private displayWelcome(): void {
		const welcomeMessage = [
			colors.header(`Welcome to ${this.name}`),
			colors.border(80), // Assuming 80 cols, might need adjustment based on resize info
			colors.formatInfo(`Use 'help' for available commands.`),
			colors.formatInfo(`Use 'exit' to quit.`),
			// Add other relevant info
			colors.border(80),
		].join('\n') + '\n';

		this._sendOutput(welcomeMessage);
		this.showPrompt();
	}

	/**
	 * Show help information
	 */
	private showHelp(): void {
		const commands = this.commandRegistry.getCommands();
		const helpLines = [colors.formatHelpTitle('Available commands:')];
		const maxLength = Math.max(0, ...Array.from(commands.keys()).map((name: string) => name.length)); // Explicitly type name as string

		for (const [name, command] of commands) {
			const formattedCommand = colors.formatHelpCommand(name.padEnd(maxLength + 2));
			const formattedDescription = colors.formatHelpDescription(command.description || ''); // Added default empty string
			helpLines.push(`  ${formattedCommand}${formattedDescription}`);

			if (command.subcommands && command.subcommands.size > 0) {
				for (const [subName, subCmd] of command.subcommands) {
					const formattedSubCommand = colors.formatHelpCommand(`  ${subName}`.padEnd(maxLength + 2)); // Adjust padding maybe
					const formattedSubDescription = colors.formatHelpDescription(subCmd.description || '');
					helpLines.push(`    ${formattedSubCommand}${formattedSubDescription}`);
				}
			}
		}
		this._sendOutput(helpLines.join('\n') + '\n');
	}

	// --- Command Management ---
	/**
	 * Register a command with the shell
	 * @param command - The command to register
	 */
	public registerCommand(command: Command): void {
		this.commandRegistry.registerCommand(command);
	}

	/**
	 * Unregister a command from the shell
	 * @param name - The name of the command to unregister
	 * @returns True if the command was unregistered, false if it wasn't found
	 */
	public unregisterCommand(name: string): boolean {
		return this.commandRegistry.unregisterCommand(name);
	}

	// --- Event Handling ---
	/**
	 * Register an event handler
	 * @param event - The event type to listen for
	 * @param handler - The handler function
	 */
	public on(event: ShellEventType, handler: EventHandler): void {
		if (!this.eventHandlers.has(event)) {
			this.eventHandlers.set(event, new Set());
		}
		this.eventHandlers.get(event)?.add(handler);
	}

	/**
	 * Unregister an event handler
	 * @param event - The event type to stop listening for
	 * @param handler - The handler function to remove
	 */
	public off(event: ShellEventType, handler: EventHandler): void {
		const handlers = this.eventHandlers.get(event);
		if (handlers) {
			handlers.delete(handler);
		}
	}

	/**
	 * Emit an event to all registered handlers
	 * @param event - The event to emit
	 */
	private emitEvent(event: ShellEvent): void {
		const handlers = this.eventHandlers.get(event.type);
		if (handlers) {
			for (const handler of handlers) {
				try {
					handler(event);
				} catch (error) {
					console.error(`[Shell] Error in event handler for ${event.type}:`, error);
				}
			}
		}
	}

	// --- Input Processing Logic ---
	/**
	 * Process raw input data received from the client.
	 * This parses characters, handles escape sequences, updates the buffer,
	 * and calls the processInputCallback when a full command is entered.
	 * @param data Raw byte data from the client.
	 */
	public handleInputData(data: Uint8Array): void {
		if (!this.isRunning) return;

		let escapeState = 0; // 0: normal, 1: got ESC, 2: got CSI
		let escapeBuffer = ''; // Buffer to store escape sequence characters

		// TODO: Scrolling needs remote handling strategy
		if (this.layout.handleScrollKeys(data)) { return; } // Use return to exit function if scroll key handled

		const input = this.decoder.decode(data);
		for (let i = 0; i < input.length; i++) {
			const char = input[i];
			const charCode = char.charCodeAt(0);

			// --- Handle Escape Sequences ---
			if (escapeState === 0 && char === '\x1B') { // ESC
				escapeState = 1;
				escapeBuffer = '\x1B';
				continue;
			}
			if (escapeState === 1) {
				escapeBuffer += char;
				if (char === '[') { // Control Sequence Introducer (CSI)
					escapeState = 2;
				} else { // Not a CSI sequence (e.g., Alt+key) - ignore for now
					escapeState = 0;
					escapeBuffer = '';
				}
				continue;
			}
			if (escapeState === 2) {
				escapeBuffer += char;
				// Check for complete CSI sequences (like arrows)
				if (char >= '@' && char <= '~') { // Sequence termination characters
					switch (escapeBuffer) {
						case '\x1b[A': // Up Arrow
						case '\x1b[B': // Down Arrow
							this.handleArrowKey(char);
							break;
						case '\x1b[C': // Right Arrow
							this.moveCursorRight();
							break;
						case '\x1b[D': // Left Arrow
							this.moveCursorLeft();
							break;
						// Add more escape codes if needed (Home, End, Delete, etc.)
						// case '\x1b[3~': // Delete key - Needs deleteAfterCursor logic
						// 	this.deleteAfterCursor();
						//	break;
						// case '\x1b[H': // Home
						//  this.cursorPosition = 0;
						//  this.updateInputWithCursor();
						//  break;
						// case '\x1b[F': // End
						//  this.cursorPosition = this.buffer.length;
						//  this.updateInputWithCursor();
						//  break;
						default:
							// Ignore unhandled sequences
							// console.log("Unhandled escape:", escapeBuffer);
							break;
					}
					escapeState = 0;
					escapeBuffer = '';
				} else if (!(/[0-9;]/.test(char))) { // If not part of sequence parameters
					// Invalid sequence or one we don't handle fully
					escapeState = 0;
					escapeBuffer = '';
				}
				// If still in state 2, continue collecting sequence parts
				continue;
			}

			// --- Handle Regular Input ---
			if (escapeState === 0) {
				if (char === '\r' || char === '\n') { // Enter/Return
					this.executeCurrentBuffer();
				} else if (charCode === 3) { // Ctrl+C
					// Signal interruption - Server needs to decide how to handle this
					this._sendOutput('^C\n'); // Echo ^C locally
					// Optionally: emitEvent({ type: ShellEventType.INTERRUPT, ... });
					this.buffer = ''; // Clear buffer
					this.cursorPosition = 0;
					this.historyIndex = -1;
					this.showPrompt();
				} else if (charCode === 127 || charCode === 8) { // Backspace (127 common, 8 sometimes)
					this.deleteBeforeCursor();
				} else if (charCode === 9) { // Tab
					this.handleTabCompletion();
				} else if (char >= ' ') { // Printable characters
					this.insertAtCursor(char);
					this.updateInputWithCursor(); // Explicitly update display after insert
				} else {
					// Ignore other control characters for now
					// console.log("Ignored char code:", charCode);
				}
			}
		} // End loop through input characters
	}


	/**
	 * Execute the current buffer as a command via the callback.
	 */
	private async executeCurrentBuffer(): Promise<void> {
		const command = this.buffer.trim();

		// Send newline to simulate command execution locally
		this._sendOutput('\n');

		// Add to history if non-empty and unique
		if (command && (!this.history.length || this.history[this.history.length - 1] !== command)) {
			this.history.push(command);
		}
		this.historyIndex = -1; // Reset history navigation
		this.tempBuffer = '';

		// Clear internal buffer state
		const bufferToExecute = this.buffer; // Capture before clearing
		this.buffer = '';
		this.cursorPosition = 0;

		// Execute via callback if command exists
		if (this.processInputCallback && bufferToExecute.trim()) {
			try {
				await this.processInputCallback(bufferToExecute.trim());
			} catch (error) {
				this.write(`Error processing command: ${error instanceof Error ? error.message : String(error)}`, { format: 'error' });
				console.error("[Shell] Error in processInputCallback:", error);
			}
		}

		// Show prompt again if still running
		if (this.isRunning) {
			this.showPrompt();
		}
	}

	/**
	 * Execute a command (now primarily for internal/server use).
	 * Command actions should use context.write for output.
	 * @param commandInput - The command string to execute
	 * @returns Promise resolving to a CommandResult object.
	 */
	public async executeCommand(commandInput: string): Promise<CommandResult> { // Changed return type
		if (!commandInput) return { success: false, error: new Error('Empty command input') }; // Return CommandResult

		const context: CommandContext = {
			shell: this,
			write: (content: string, options?: OutputOptions) => this.write(content, options), // Add types
		};
		const commandToExecute = commandInput.startsWith('/') ? commandInput.substring(1) : commandInput;

		this.emitEvent({
			type: ShellEventType.COMMAND_BEFORE,
			timestamp: Date.now(),
			payload: commandToExecute,
		});

		try {
			// Directly call the registry's executeCommand
			const result: CommandResult = await this.commandRegistry.executeCommand(commandToExecute, context);

			// Emit events based on the result from the registry
			if (result.success) {
				// Don't emit COMMAND_AFTER if help was just displayed, only on actual execution
				// We need more info from CommandResult or handle this differently if needed.
				// For now, assume any success means emit.
				this.emitEvent({
					type: ShellEventType.COMMAND_AFTER,
					timestamp: Date.now(),
					payload: { command: commandToExecute, success: true },
				});
			} else {
				// Error might have already been written by the registry (parser error, help shown)
				// But we still need to emit the error event if an error object exists
				if (result.error) {
					this.emitEvent({
						type: ShellEventType.COMMAND_ERROR,
						timestamp: Date.now(),
						payload: { command: commandToExecute, error: result.error },
					});
				}
				// If it failed but wasn't an error (e.g. help shown), no error event needed here.

				// Handle "Unknown command" specifically if the registry indicated that
				// (Assuming registry returns a specific error or message for this)
				if (result.error?.message.startsWith('Unknown command')) {
					const suggestions = await this.commandRegistry.getSuggestions(commandToExecute, context);
					const errorMsgBase = `Unknown command "${commandInput}"`;
					const suggestionMsg = suggestions.length > 0 ? `. Did you mean "${suggestions[0]}"?` : '';
					this.write(errorMsgBase + suggestionMsg, { format: 'error' });
					// Error event was already emitted above if result.error existed
				}
			}
			return result; // Return the result from the registry

		} catch (error) { // Catch errors ONLY from the command's ACTION execution itself
			const errorMessage = (error instanceof Error ? error.message : String(error));
			this.write(`Error executing command: ${errorMessage}`, { format: 'error' }); // Use context.write
			console.error(`[Shell][executeCommand] Error:`, error);
			this.emitEvent({
				type: ShellEventType.COMMAND_ERROR,
				timestamp: Date.now(),
				payload: { command: commandToExecute, error: error instanceof Error ? error : new Error(String(error)) },
			});
			// Return a failure result if action throws
			return { success: false, error: error instanceof Error ? error : new Error(String(error)) };
		}
	}

	/**
	 * Handle arrow key navigation for history
	 */
	private handleArrowKey(key: string): void {
		if (key === this.UP_ARROW) {
			if (this.historyIndex === -1) { // Starting navigation up
				this.tempBuffer = this.buffer; // Save current buffer
			}
			if (this.historyIndex < this.history.length - 1) {
				this.historyIndex++;
				const historyCommand = this.history[this.history.length - 1 - this.historyIndex];
				this.buffer = historyCommand;
				this.cursorPosition = historyCommand.length;
				this.updateInputWithCursor();
			}
		} else if (key === this.DOWN_ARROW) {
			if (this.historyIndex > 0) { // Moving down within history
				this.historyIndex--;
				const historyCommand = this.history[this.history.length - 1 - this.historyIndex];
				this.buffer = historyCommand;
				this.cursorPosition = historyCommand.length;
				this.updateInputWithCursor();
			} else if (this.historyIndex === 0) { // Moving down to the saved temp buffer
				this.historyIndex = -1;
				this.buffer = this.tempBuffer;
				this.cursorPosition = this.tempBuffer.length;
				this.updateInputWithCursor();
			}
		}
	}

	/**
	 * Handle tab completion (basic version)
	 */
	private async handleTabCompletion(): Promise<void> { // Make async
		const input = this.buffer.slice(0, this.cursorPosition); // Use input up to cursor for context

		// Create context needed for getSuggestions
		const context: CommandContext = {
			shell: this,
			write: (content: string, options?: OutputOptions) => this.write(content, options),
		};

		const suggestions = await this.commandRegistry.getSuggestions(input, context); // Await and pass context
		
		// We still need the last word to determine what part of the suggestion to insert
		const parts = input.split(/\s+/);
		const lastPart = parts[parts.length - 1] || '';

		if (suggestions.length === 1) {
			// Autocomplete
			const suggestion = suggestions[0]; // e.g., "echo normal"
			// Find the part of the suggestion that needs to be inserted
			// For "echo nor", suggestion is "echo normal", lastPart is "nor"
			// We need to find what comes after "echo " in the suggestion, relative to lastPart
			const completion = suggestion.substring(input.length); // Insert the rest of the suggestion
			this.insertAtCursor(completion); // Update buffer and cursor position internally
			// Check if it's a full command/subcommand (ends without needing more input)
			// and add a space if the cursor is now at the end.
			const cmd = this.commandRegistry.getCommand(suggestion) || this.commandRegistry.getSubcommand(suggestion);
			if (cmd && !cmd.subcommands && this.cursorPosition === this.buffer.length) {
				this.insertAtCursor(' '); // Insert space, updates cursor internally again
			}
			   // Explicitly set cursor to the end of the buffer *after* all insertions
			   this.cursorPosition = this.buffer.length;
			this.updateInputWithCursor(); // Update display using the explicitly set cursor position

		} else if (suggestions.length > 1) {
			// Show suggestions
			this._sendOutput('\n'); // Newline before showing suggestions
			// displaySuggestions expects string[], ensure we have awaited result
			this.displaySuggestions(suggestions, input);
			this.showPrompt(); // Redraw prompt and current buffer after suggestions
		}
	}

	/**
	 * Find the longest common prefix among an array of strings
	 */
	private findCommonPrefix(strings: string[]): string {
		if (!strings || strings.length === 0) return '';
		if (strings.length === 1) return strings[0];
		let prefix = strings[0];
		for (let i = 1; i < strings.length; i++) {
			let j = 0;
			while (j < prefix.length && j < strings[i].length && prefix[j] === strings[i][j]) {
				j++;
			}
			prefix = prefix.substring(0, j);
			if (prefix === '') break;
		}
		return prefix;
	}

	/**
	 * Display command suggestions
	 */
	private displaySuggestions(suggestions: string[], _commandInput: string): void {
		// Simplified display for remote
		const outputLines = [
			colors.formatHelpTitle('Suggestions:'),
			'  ' + suggestions.join('  ') // Simple space separation
		];
		this._sendOutput(outputLines.join('\n') + '\n');
	}

	/**
	 * Show the prompt and current input buffer via callback
	 */
	private showPrompt(): void {
		// Send ANSI codes to clear current line, move to start, write prompt
		const promptOutput = `\x1b[2K\x1b[G${this.prompt}`;
		this._sendOutput(promptOutput);
		// updateInputWithCursor will handle buffer content and final cursor positioning
		this.updateInputWithCursor();
	}

	/**
	 * Move cursor one position left
	 */
	private moveCursorLeft(): void {
		if (this.cursorPosition > 0) {
			this.cursorPosition--;
			this.updateInputWithCursor(); // Update remote display
		}
	}

	/**
	 * Move cursor one position right
	 */
	private moveCursorRight(): void {
		if (this.cursorPosition < this.buffer.length) {
			this.cursorPosition++;
			this.updateInputWithCursor(); // Update remote display
		}
	}

	/**
	 * Update remote display with current buffer and cursor position using ANSI codes
	 */
	private updateInputWithCursor(): void {
		const cursorCol = this.prompt.length + this.cursorPosition + 1; // +1 for 1-based column
		// ANSI: \x1b[2K (Clear line), \x1b[G (Move to col 1), Write prompt+buffer, \x1b[<N>G (Move to col N)
		const output = `\x1b[2K\x1b[G${this.prompt}${this.buffer}\x1b[${cursorCol}G`;
		this._sendOutput(output);
	}

	/**
	 * Insert character at current cursor position
	 */
	private insertAtCursor(char: string): void {
		const pre = this.buffer.slice(0, this.cursorPosition);
		const post = this.buffer.slice(this.cursorPosition);
		this.buffer = pre + char + post;
		this.cursorPosition++;
		this.updateInputWithCursor(); // Update remote display
	}

	/**
	 * Delete character before cursor position
	 */
	private deleteBeforeCursor(): void {
		if (this.cursorPosition > 0) {
			const pre = this.buffer.slice(0, this.cursorPosition - 1);
			const post = this.buffer.slice(this.cursorPosition);
			this.buffer = pre + post;
			this.cursorPosition--;
			this.updateInputWithCursor(); // Update remote display
		}
	}
}
