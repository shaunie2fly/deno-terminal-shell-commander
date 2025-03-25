/**
 * Shell class - Core shell implementation with instance-based command system
 * @module
 */
import * as colors from '../colors.ts';
import { CommandRegistry } from '../commands/Registry.ts';
import { Command } from '../commands/types.ts';
import { LayoutManager } from '../ui/layout/layout_manager.ts';
import { EventHandler, OutputFormat, OutputOptions, ShellEvent, ShellEventType, ShellOptions } from './types.ts';

/**
 * Core Shell class for terminal interfaces
 */
export class Shell {
	private name: string;
	private prompt: string;
	private layout: LayoutManager;
	private commandRegistry: CommandRegistry;
	private isRunning = false;
	private buffer = '';
	private cursorPosition = 0;
	private history: string[] = [];
	private historyIndex = -1;
	private tempBuffer = '';
	private readonly decoder = new TextDecoder();
	private readonly eventHandlers = new Map<ShellEventType, Set<EventHandler>>();

	// Key codes
	private readonly UP_ARROW = 'A';
	private readonly DOWN_ARROW = 'B';
	private readonly RIGHT_ARROW = 'C';
	private readonly LEFT_ARROW = 'D';
	private readonly TAB = 9;
	private readonly CTRL_C = '';
	private readonly PAGE_UP = '5~';
	private readonly PAGE_DOWN = '6~';

	/**
	 * Create a new shell instance
	 * @param options - Configuration options for the shell
	 */
	constructor(options: ShellOptions = { name: undefined, prompt: undefined, width: undefined, height: undefined }) {
		// Set shell properties from options with defaults
		this.name = options.name ?? 'Terminal Shell';
		this.prompt = options.prompt ?? '> ';

		// Initialize layout manager
		this.layout = new LayoutManager();
		
		// Update layout dimensions if provided
		if (options.width !== undefined && options.height !== undefined) {
			this.layout.updateTerminalSize(options.width, options.height);
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
			name: 'clear',
			description: 'Clear the terminal screen',
			action: () => this.clear(),
		});

		// Help command
		this.commandRegistry.registerCommand({
			name: 'help',
			description: 'Show available commands',
			action: () => this.showHelp(),
		});

		// Exit command
		this.commandRegistry.registerCommand({
			name: 'exit',
			description: 'Exit the shell',
			action: () => this.stop(),
		});
	}

	/**
	 * Start the shell
	 */
	public async start(): Promise<void> {
		// Emit start event
		this.emitEvent({
			type: ShellEventType.START,
			timestamp: Date.now(),
		});

		// Configure terminal
		try {
			await Deno.stdin.setRaw(true);
		} catch (error: unknown) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			this.write(`Failed to set raw mode: ${errorMessage}`, { format: 'error' });
			return;
		}

		this.isRunning = true;
		this.clear();

		// Display welcome message
		this.displayWelcome();

		// Start reading input
		await this.startReading();
	}

	/**
	 * Display welcome message
	 */
	private displayWelcome(): void {
		const welcomeMessage = [
			colors.header(`Welcome to ${this.name}`),
			colors.border(80),
			colors.formatInfo(`Commands can be entered with or without a leading slash (e.g., 'clear' or '/clear').`),
			colors.formatInfo(`Use 'exit' or '/exit' to quit.`),
			colors.formatInfo(`Press Tab for command completion.`),
			colors.formatInfo(`Use arrow keys (↑/↓) for history and (←/→) for cursor navigation.`),
			colors.formatInfo(`Use PageUp/PageDown or Shift+Arrow keys to scroll through output history.`),
			colors.formatInfo(`Press ESC to exit scroll mode and return to most recent output.`),
			colors.border(80),
		].join('\n') + '\n';

		this.write(welcomeMessage);
		this.showPrompt();
	}

	/**
	 * Show help information
	 */
	private showHelp(): void {
		const commands = this.commandRegistry.getCommands();

		const helpLines = [
			colors.formatHelpTitle('Available commands:'),
		];

		const maxLength = Math.max(...Array.from(commands.keys()).map((name) => name.length));

		for (const [name, command] of commands) {
			const formattedCommand = colors.formatHelpCommand(name.padEnd(maxLength + 2));
			const formattedDescription = colors.formatHelpDescription(command.description);
			helpLines.push(`  ${formattedCommand}${formattedDescription}`);

			// Add subcommands if they exist
			if (command.subcommands && command.subcommands.size > 0) {
				for (const [subName, subCmd] of command.subcommands) {
					const fullName = `${name} ${subName}`;
					const formattedSubCommand = colors.formatHelpCommand(`  ${subName}`.padEnd(maxLength + 2));
					const formattedSubDescription = colors.formatHelpDescription(subCmd.description);
					helpLines.push(`    ${formattedSubCommand}${formattedSubDescription}`);
				}
			}
		}

		this.write(helpLines.join('\n') + '\n');
	}

	/**
	 * Stop the shell
	 */
	public async stop(): Promise<void> {
		if (!this.isRunning) return;

		this.isRunning = false;

		// Emit stop event
		this.emitEvent({
			type: ShellEventType.STOP,
			timestamp: Date.now(),
		});

		// Restore terminal
		await Deno.stdin.setRaw(false);
		this.write('\n' + colors.formatSuccess('Shell terminated.') + '\n');
	}

	/**
	 * Write content to the shell output
	 * @param content - Content to write
	 * @param options - Output options for formatting
	 */
	public write(content: string, options: OutputOptions = {}): void {
		// Apply formatting if specified
		let formattedContent = content;
		if (options.format) {
			formattedContent = this.formatOutput(content, options.format);
		}

		// Add newline if specified
		if (options.newline !== false) {
			formattedContent += '\n';
		}

		this.layout.writeOutput(formattedContent);
		this.layout.render(Deno.stdout);
	}

	/**
	 * Format output based on specified format
	 */
	private formatOutput(content: string, format: OutputFormat): string {
		switch (format) {
			case 'success':
				return colors.formatSuccess(content);
			case 'error':
				return colors.formatError('Error', content);
			case 'info':
				return colors.formatInfo(content);
			case 'warning':
				return colors.formatWarning(content);
			case 'header':
				return colors.header(content);
			default:
				return content;
		}
	}

	/**
	 * Clear the terminal screen
	 */
	public clear(): void {
		this.layout.clear();
		this.layout.render(Deno.stdout);
	}

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
				handler(event);
			}
		}
	}

	/**
	 * Start reading from stdin
	 */
	private async startReading(): Promise<void> {
		const buffer = new Uint8Array(1024);
		let escapeState = 0; // 0: normal, 1: got ESC, 2: got CSI
		let escapeBuffer = ''; // Buffer to store escape sequence characters

		while (this.isRunning) {
			const n = await Deno.stdin.read(buffer);
			if (n === null) break;

			// Check if this is a scroll-related key first
			if (this.layout.handleScrollKeys(buffer.subarray(0, n))) {
				// Key was handled by scroll handler
				continue;
			}

			const input = this.decoder.decode(buffer.subarray(0, n));

			for (let i = 0; i < input.length; i++) {
				const char = input[i];
				const charCode = char.charCodeAt(0);

				// Handle escape sequences
				if (escapeState === 0 && char === '\x1B') {
					escapeState = 1;
					escapeBuffer = '\x1B';
					continue;
				}

				if (escapeState === 1) {
					escapeBuffer += char;
					if (char === '[') {
						escapeState = 2;
						continue;
					} else {
						// Not a CSI sequence
						escapeState = 0;
						escapeBuffer = '';
					}
				}

				if (escapeState === 2) {
					escapeBuffer += char;
					// Check for complete escape sequences
					if (char === this.UP_ARROW || char === this.DOWN_ARROW) {
						this.handleArrowKey(char);
						escapeState = 0;
						escapeBuffer = '';
						continue;
					} else if (char === this.LEFT_ARROW) {
						this.moveCursorLeft();
						escapeState = 0;
						escapeBuffer = '';
						continue;
					} else if (char === this.RIGHT_ARROW) {
						this.moveCursorRight();
						escapeState = 0;
						escapeBuffer = '';
						continue;
					} else if (escapeBuffer.endsWith(this.PAGE_UP) || escapeBuffer.endsWith(this.PAGE_DOWN)) {
						// Let these be handled in the next iteration by the layout manager
						break;
					} else if (/[0-9;]/.test(char)) {
						// This could be part of a longer sequence like Shift+arrows
						continue;
					} else {
						// Some other escape sequence we don't handle
						escapeState = 0;
						escapeBuffer = '';
					}
				}

				// Reset escape state if sequence is incomplete
				if (escapeState > 0 && !(/[0-9;[\x1B]/.test(char))) {
					escapeState = 0;
					escapeBuffer = '';
					continue;
				}

				// Handle regular input
				if (escapeState === 0) {
					if (char === '\r' || char === '\n') {
						// On enter key, process the command
						this.executeCurrentBuffer();
					} else if (char === this.CTRL_C) {
						this.write('^C');
						this.buffer = '';
						this.cursorPosition = 0;
						this.historyIndex = -1;
						this.showPrompt();
					} else if (char === '\b' || charCode === 127) { // Backspace or Delete
						this.deleteBeforeCursor();
					} else if (charCode === this.TAB) { // Tab key
						this.handleTabCompletion();
					} else if (char >= ' ') { // Printable characters
						this.insertAtCursor(char);
					}
				}
			}
		}
	}

	/**
	 * Execute the current buffer as a command
	 */
	private async executeCurrentBuffer(): Promise<void> {
		const command = this.buffer.trim();

		// Add to history if non-empty and unique
		if (command && (!this.history.length || this.history[this.history.length - 1] !== command)) {
			this.history.push(command);
		}

		// Reset history navigation
		this.historyIndex = -1;
		this.tempBuffer = '';

		// Clear buffer and update display
		this.write('');
		this.buffer = '';
		this.cursorPosition = 0;

		// Handle command execution
		await this.executeCommand(command);

		// Show prompt if shell is still running
		if (this.isRunning) {
			this.showPrompt();
		}
	}

	/**
	 * Execute a command
	 * @param commandInput - The command string to execute
	 */
	private async executeCommand(commandInput: string): Promise<void> {
		if (!commandInput) {
			return;
		}

		// Check if command starts with a slash and remove it for execution
		const commandToExecute = commandInput.startsWith('/') ? commandInput.substring(1) : commandInput;

		// Emit command before event
		this.emitEvent({
			type: ShellEventType.COMMAND_BEFORE,
			timestamp: Date.now(),
			payload: commandToExecute,
		});

		try {
			// Execute the command
			const result = await this.commandRegistry.executeCommand(commandToExecute);

			if (result.success) {
				// Emit command after event
				this.emitEvent({
					type: ShellEventType.COMMAND_AFTER,
					timestamp: Date.now(),
					payload: { command: commandToExecute, success: true },
				});
			} else {
				// Handle command failure
				const suggestions = this.commandRegistry.getSuggestions(commandToExecute);
				const errorMessage = suggestions.length > 0 ? `Unknown command "${commandInput}". Did you mean "${suggestions[0]}"?` : `Unknown command "${commandInput}"`;

				this.write(errorMessage, { format: 'error' });

				// Emit command error event
				this.emitEvent({
					type: ShellEventType.COMMAND_ERROR,
					timestamp: Date.now(),
					payload: { command: commandToExecute, error: result.error },
				});
			}
		} catch (error) {
			// Handle unexpected errors
			const errorMessage = error instanceof Error ? error.message : String(error);
			this.write(`Error executing command: ${errorMessage}`, { format: 'error' });

			// Emit command error event
			this.emitEvent({
				type: ShellEventType.COMMAND_ERROR,
				timestamp: Date.now(),
				payload: { command: commandToExecute, error },
			});
		}
	}

	/**
	 * Handle arrow key navigation
	 */
	private handleArrowKey(key: string): void {
		if (key === this.UP_ARROW) {
			if (this.historyIndex === -1) {
				this.tempBuffer = this.buffer;
			}

			if (this.historyIndex < this.history.length - 1) {
				this.historyIndex++;
				const historyCommand = this.history[this.history.length - 1 - this.historyIndex];
				this.buffer = historyCommand;
				this.cursorPosition = historyCommand.length;
				this.updateInputWithCursor();
			}
		} else if (key === this.DOWN_ARROW) {
			if (this.historyIndex > -1) {
				this.historyIndex--;

				if (this.historyIndex === -1) {
					this.buffer = this.tempBuffer;
					this.cursorPosition = this.tempBuffer.length;
				} else {
					const historyCommand = this.history[this.history.length - 1 - this.historyIndex];
					this.buffer = historyCommand;
					this.cursorPosition = historyCommand.length;
				}

				this.updateInputWithCursor();
			}
		}
	}

	/**
	 * Handle tab completion
	 */
	private handleTabCompletion(): void {
		const input = this.buffer.trim();
		if (!input) return;

		// Handle commands with or without leading slash
		const commandInput = input.startsWith('/') ? input.substring(1) : input;

		// Check if input is a complete command name with no space after it
		const isCompleteCommand = !commandInput.includes(' ') &&
			this.commandRegistry.getCommands().has(commandInput);

		// If this is a complete command with no space, and it has subcommands, show help
		if (isCompleteCommand) {
			const command = this.commandRegistry.getCommand(commandInput);

			if (command?.subcommands && command.subcommands.size > 0) {
				this.write('');
				const outputLines: string[] = [];

				outputLines.push(colors.formatHelpTitle(`Available subcommands for '${commandInput}':`));

				const maxLength = Math.max(...Array.from(command.subcommands.keys()).map((s) => s.length));

				for (const [name, subCmd] of command.subcommands) {
					const formattedCommand = colors.formatHelpCommand(name.padEnd(maxLength + 2));
					const formattedDescription = colors.formatHelpDescription(subCmd.description);
					outputLines.push(`  ${formattedCommand}${formattedDescription}`);
				}

				this.write(outputLines.join('\n'));
				this.showPrompt();
				return;
			}
		}

		// Get command suggestions from registry
		const suggestions = this.commandRegistry.getSuggestions(commandInput);

		if (suggestions.length === 0) {
			// No matches found, do nothing
			return;
		} else if (suggestions.length === 1) {
			// Single match - autocomplete
			const completedCommand = input.startsWith('/') ? `/${suggestions[0]}` : suggestions[0];
			this.buffer = completedCommand;
			this.cursorPosition = completedCommand.length;
			this.updateInputWithCursor();
		} else if (suggestions.length > 1) {
			// Multiple matches - show suggestions
			this.write('');

			// Find common prefix for partial completion
			const commonPrefix = this.findCommonPrefix(suggestions);

			// Display all suggestions
			this.displaySuggestions(suggestions, commandInput);

			// Handle common prefix completion
			const isSubcommandCompletion = commandInput.includes(' ');

			if (isSubcommandCompletion) {
				// Handle subcommand completion
				const parts = commandInput.split(/\s+/);
				const baseCommand = parts.slice(0, parts.length - 1).join(' ');
				const subcommandPartial = parts[parts.length - 1];

				if (commonPrefix.length > subcommandPartial.length) {
					const subcommandPrefix = commonPrefix.substring(commonPrefix.indexOf(' ') + 1);
					const newCommand = baseCommand ? `${baseCommand} ${subcommandPrefix}` : subcommandPrefix;
					const prefixWithSlash = input.startsWith('/') ? `/${newCommand}` : newCommand;

					this.buffer = prefixWithSlash;
					this.cursorPosition = prefixWithSlash.length;
					this.updateInputWithCursor();
					return;
				}
			} else if (commonPrefix.length > commandInput.length) {
				const prefixToUse = input.startsWith('/') ? `/${commonPrefix}` : commonPrefix;

				this.buffer = prefixToUse;
				this.cursorPosition = prefixToUse.length;
				this.updateInputWithCursor();
				return;
			}

			this.showPrompt();
		}
	}

	/**
	 * Find the longest common prefix among an array of strings
	 */
	private findCommonPrefix(strings: string[]): string {
		if (strings.length === 0) return '';
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
	 * Display command suggestions with descriptions
	 */
	private displaySuggestions(suggestions: string[], _commandInput: string): void {
		// Check if these are subcommand suggestions
		const isSubcommandSuggestion = suggestions[0].includes(' ');

		// Build content lines in arrays first, then join at the end
		const outputLines: string[] = [];

		if (isSubcommandSuggestion) {
			// Subcommand suggestions
			outputLines.push(colors.formatHelpTitle('Available options:'));

			const maxLength = Math.max(...suggestions.map((s) => s.length));

			for (const suggestion of suggestions) {
				const description = this.commandRegistry.getSubcommandDescription(suggestion);
				const formattedCommand = colors.formatHelpCommand(suggestion.padEnd(maxLength + 2));
				const formattedDescription = description ? colors.formatHelpDescription(description) : '';
				outputLines.push(`  ${formattedCommand}${formattedDescription}`);
			}
		} else {
			// Basic command suggestions
			outputLines.push(colors.formatHelpTitle('Available commands:'));

			const maxLength = Math.max(...suggestions.map((s) => s.length));
			const columns = Math.floor(80 / (maxLength + 4)); // Assume 80 column terminal width

			if (suggestions.length > 6) {
				// Show in columns without descriptions
				let row = [];

				for (let i = 0; i < suggestions.length; i++) {
					row.push(colors.formatHelpCommand(suggestions[i].padEnd(maxLength + 2)));

					if (row.length === columns || i === suggestions.length - 1) {
						outputLines.push('  ' + row.join(''));
						row = [];
					}
				}
			} else {
				// Show with descriptions
				for (const cmd of suggestions) {
					const description = this.commandRegistry.getDescription(cmd);
					const formattedCommand = colors.formatHelpCommand(cmd.padEnd(maxLength + 2));
					const formattedDescription = description ? colors.formatHelpDescription(description) : '';
					outputLines.push(`  ${formattedCommand}${formattedDescription}`);
				}
			}
		}

		// Write all lines at once
		this.write(outputLines.join('\n'));
	}

	/**
	 * Show the prompt
	 */
	private showPrompt(): void {
		this.layout.updateInputWithCursor(this.prompt + this.buffer, this.prompt.length + this.cursorPosition);
		this.layout.render(Deno.stdout);
	}

	/**
	 * Move cursor one position left
	 */
	private moveCursorLeft(): void {
		if (this.cursorPosition > 0) {
			this.cursorPosition--;
			this.updateInputWithCursor();
		}
	}

	/**
	 * Move cursor one position right
	 */
	private moveCursorRight(): void {
		if (this.cursorPosition < this.buffer.length) {
			this.cursorPosition++;
			this.updateInputWithCursor();
		}
	}

	/**
	 * Update display with current cursor position
	 */
	private updateInputWithCursor(): void {
		this.layout.updateInputWithCursor(this.prompt + this.buffer, this.prompt.length + this.cursorPosition);
	}

	/**
	 * Insert character at current cursor position
	 */
	private insertAtCursor(char: string): void {
		const pre = this.buffer.slice(0, this.cursorPosition);
		const post = this.buffer.slice(this.cursorPosition);
		this.buffer = pre + char + post;
		this.cursorPosition++;
		this.updateInputWithCursor();
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
			this.updateInputWithCursor();
		}
	}
}
