import { commandRegistry } from './commands.ts';
import { serviceRegistry } from './services.ts';
import * as colors from './colors.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// ANSI control sequences
const ESC = '\x1b';
const CSI = ESC + '[';
const UP_ARROW = 'A';
const DOWN_ARROW = 'B';
const BACKSPACE_SEQUENCE = '\b \b';
const TAB = 9; // ASCII code for Tab key

// Screen control sequences
const CLEAR_LINE = CSI + '2K';
const MOVE_START = '\r';
const CLEAR_SCREEN = CSI + '2J' + CSI + 'H';

/**
 * Interface for shell component configuration
 */
interface ShellConfig {
	name?: string;
	prompt?: string;
}

/**
 * Shell class managing the terminal user interface
 */
export class Shell {
	private buffer = '';
	private history: string[] = [];
	private historyIndex = -1;
	private tempBuffer = ''; // Store buffer when navigating history
	private name: string;
	private prompt: string;
	private isRunning = false;

	constructor(config: ShellConfig = {}) {
		this.name = config.name ?? 'Terminal Shell';
		this.prompt = config.prompt ?? '> ';
	}

	/**
	 * Write content to stdout
	 */
	private write(content: string): void {
		Deno.stdout.writeSync(encoder.encode(content));
	}

	/**
	 * Clear the terminal screen
	 */
	public clearScreen(): void {
		this.write(CLEAR_SCREEN);
		// Removed prompt display from here as it will be shown after command execution
	}

	/**
	 * Display the prompt
	 */
	private showPrompt(): void {
		this.write(this.prompt);
	}

	/**
	 * Update the current buffer and display
	 */
	private updateBuffer(newContent: string): void {
		// Clear current line and move to start
		this.write(MOVE_START + CLEAR_LINE);
		// Update buffer and show new content
		this.buffer = newContent;
		this.write(this.prompt + this.buffer);
	}

	/**
	 * Handle arrow key navigation
	 */
	private handleArrowKey(key: string): void {
		if (key === UP_ARROW) {
			if (this.historyIndex === -1) {
				this.tempBuffer = this.buffer;
			}
			if (this.historyIndex < this.history.length - 1) {
				this.historyIndex++;
				this.updateBuffer(this.history[this.history.length - 1 - this.historyIndex]);
			}
		} else if (key === DOWN_ARROW) {
			if (this.historyIndex > -1) {
				this.historyIndex--;
				if (this.historyIndex === -1) {
					this.updateBuffer(this.tempBuffer);
				} else {
					this.updateBuffer(this.history[this.history.length - 1 - this.historyIndex]);
				}
			}
		}
	}

	/**
	 * Handle tab completion
	 *
	 * Processes tab key presses to:
	 * 1. Auto-complete partial commands when there's a single match
	 * 2. Display multiple suggestions when there are several matches
	 * 3. Handle contextual completion based on command structure
	 * 4. Show all available options for a command when tab is pressed after a command
	 */
	private handleTabCompletion(): void {
		const input = this.buffer.trim();

		// Skip tab completion if buffer is empty
		if (!input) return;

		// Handle commands with or without leading slash
		const commandInput = input.startsWith('/') ? input.substring(1) : input;

		// Get command suggestions from registry
		const suggestions = commandRegistry.getSuggestions(commandInput);

		if (suggestions.length === 0) {
			// No matches found, do nothing
			return;
		} else if (suggestions.length === 1) {
			// Single match - autocomplete
			const completedCommand = input.startsWith('/') ? `/${suggestions[0]}` : suggestions[0];
			this.updateBuffer(completedCommand);
		} else if (suggestions.length > 1) {
			// Multiple matches - show suggestions
			this.write('\n');

			// Find common prefix for partial completion
			const commonPrefix = this.findCommonPrefix(suggestions);

			// Display all suggestions in a formatted table-like layout with descriptions
			this.displaySuggestions(suggestions, commandInput);

			// If there's a common prefix longer than current input, use it
			const currentCommandPart = commandInput.split(/\s+/).pop() || '';

			// Determine if we're completing a subcommand (command that contains spaces)
			const isSubcommandCompletion = commandInput.includes(' ');

			if (isSubcommandCompletion) {
				// Handle contextual completion for subcommands
				const parts = commandInput.split(/\s+/);
				const rootCommand = parts[0];
				const subcommandPartial = parts.length > 1 ? parts[parts.length - 1] : '';

				// Extract the base command (everything before the last part being completed)
				const baseCommand = parts.slice(0, parts.length - 1).join(' ');

				// If commonPrefix is longer than current input part, update it
				if (commonPrefix.length > subcommandPartial.length) {
					// Extract just the subcommand part from the common prefix by removing the root command
					const subcommandPrefix = commonPrefix.substring(commonPrefix.indexOf(' ') + 1);

					// Create a properly formatted command without duplication
					let newCommand;
					if (baseCommand && subcommandPrefix.startsWith(baseCommand)) {
						// If the subcommand already includes the base command, use it directly
						newCommand = subcommandPrefix;
					} else {
						// Otherwise, combine them properly
						newCommand = baseCommand ? `${baseCommand} ${subcommandPrefix}` : subcommandPrefix;
					}

					const prefixWithSlash = input.startsWith('/') ? `/${newCommand}` : newCommand;

					this.showPrompt();
					this.updateBuffer(prefixWithSlash);
					return;
				}
			} else if (commonPrefix.length > commandInput.length) {
				// For regular commands, update with common prefix if it's longer
				const prefixToUse = input.startsWith('/') ? `/${commonPrefix}` : commonPrefix;

				this.showPrompt();
				this.updateBuffer(prefixToUse);
				return;
			}

			// Just show prompt with current buffer
			this.showPrompt();
			this.write(this.buffer);
		}
	}

	/**
	 * Find the longest common prefix among an array of strings
	 *
	 * @param strings - Array of strings to find common prefix from
	 * @returns The longest common prefix
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
	 *
	 * @param suggestions - Array of command suggestions to display
	 * @param commandInput - The current command input
	 */
	private displaySuggestions(suggestions: string[], commandInput: string): void {
		// Check if these are subcommand suggestions
		const isSubcommandSuggestion = suggestions[0].includes(' ');

		if (isSubcommandSuggestion) {
			// These are subcommand suggestions, show them with descriptions
			console.log(colors.formatHelpTitle('Available options:'));

			// Get the root command
			const rootCommand = suggestions[0].split(' ')[0];

			// Calculate the maximum length for formatting
			const maxLength = Math.max(...suggestions.map((s) => s.length));

			// Show each suggestion with its description
			for (const suggestion of suggestions) {
				const description = commandRegistry.getSubcommandDescription(suggestion);
				console.log(`  ${colors.formatHelpCommand(suggestion.padEnd(maxLength + 2))}${description ? colors.formatHelpDescription(description) : ''}`);
			}
		} else {
			// These are basic command suggestions
			console.log(colors.formatHelpTitle('Available commands:'));

			// Calculate the maximum length for formatting
			const maxLength = Math.max(...suggestions.map((s) => s.length));
			const columns = Math.floor(80 / (maxLength + 4)); // Assume 80 column terminal width

			// If there are many suggestions, show in columns without descriptions
			if (suggestions.length > 6) {
				let row = [];

				for (let i = 0; i < suggestions.length; i++) {
					row.push(colors.formatHelpCommand(suggestions[i].padEnd(maxLength + 2)));

					if (row.length === columns || i === suggestions.length - 1) {
						console.log('  ' + row.join(''));
						row = [];
					}
				}
			} else {
				// For fewer suggestions, show with descriptions
				for (const cmd of suggestions) {
					const description = commandRegistry.getDescription(cmd);
					console.log(`  ${colors.formatHelpCommand(cmd.padEnd(maxLength + 2))}${description ? colors.formatHelpDescription(description) : ''}`);
				}
			}
		}
	}

	/**
	 * Handle user input
	 */
	private async handleInput(input: string): Promise<void> {
		const command = input.trim();

		// Always write a newline after command input
		this.write('\n');

		if (!command) {
			if (this.isRunning) {
				this.showPrompt();
			}
			return;
		}

		// Handle built-in commands first
		if (command === '/exit') {
			await this.shutdown();
			return;
		}

		// Check if command starts with a slash and remove it for execution
		const commandToExecute = command.startsWith('/') ? command.substring(1) : command;

		// Try executing the command
		const success = await commandRegistry.executeCommand(commandToExecute);

		// Only show error messages if command failed
		if (!success) {
			const suggestions = commandRegistry.getSuggestions(commandToExecute);
			if (suggestions.length > 0) {
				console.log(colors.formatError('Unknown command', `"${command}"`, `Did you mean "${suggestions[0]}"?`));
			} else {
				console.log(colors.formatError('Unknown command', `"${command}"`));
			}
		}

		// Show prompt if shell is still running
		if (this.isRunning) {
			this.showPrompt();
		}
	}

	/**
	 * Handle backspace input
	 */
	private handleBackspace(): void {
		if (this.buffer.length > 0) {
			this.buffer = this.buffer.slice(0, -1);
			this.write(BACKSPACE_SEQUENCE);
		}
	}

	/**
	 * Start reading from stdin
	 */
	private async startReading(): Promise<void> {
		const buffer = new Uint8Array(1024);
		let escapeState = 0; // 0: normal, 1: got ESC, 2: got CSI

		while (this.isRunning) {
			const n = await Deno.stdin.read(buffer);
			if (n === null) break;

			const input = decoder.decode(buffer.subarray(0, n));

			for (let i = 0; i < input.length; i++) {
				const char = input[i];
				const charCode = char.charCodeAt(0);

				// Handle escape sequences
				if (escapeState === 0 && char === ESC) {
					escapeState = 1;
					continue;
				}
				if (escapeState === 1 && char === '[') {
					escapeState = 2;
					continue;
				}
				if (escapeState === 2) {
					if (char === UP_ARROW || char === DOWN_ARROW) {
						this.handleArrowKey(char);
					}
					escapeState = 0;
					continue;
				}
				// Reset escape state if sequence is incomplete
				if (escapeState > 0) {
					escapeState = 0;
					continue;
				}

				// Handle regular input
				if (char === '\r' || char === '\n') {
					const command = this.buffer.trim();
					if (command && (!this.history.length || this.history[this.history.length - 1] !== command)) {
						this.history.push(command);
					}
					this.historyIndex = -1;
					this.tempBuffer = '';
					this.buffer = '';
					await this.handleInput(command);
				} else if (char === '') { // Ctrl+C
					this.write('^C\n');
					this.buffer = '';
					this.historyIndex = -1;
					this.showPrompt();
				} else if (char === '\b' || charCode === 127) { // Backspace (^H or DEL)
					this.handleBackspace();
				} else if (charCode === TAB) { // Tab key
					this.handleTabCompletion();
				} else if (char >= ' ') { // Printable characters
					this.buffer += char;
					this.write(char);
				}
			}
		}
	}

	/**
	 * Start the shell
	 */
	public async start(): Promise<void> {
		// Configure terminal
		try {
			await Deno.stdin.setRaw(true);
		} catch (error) {
			console.error(colors.formatError('Terminal Error', `Failed to set raw mode: ${error.message}`));
			return;
		}

		this.isRunning = true;
		this.clearScreen();
		console.log(colors.header(`Welcome to ${this.name}`));
		console.log(colors.border(80));
		console.log(colors.formatInfo(`Commands can be entered with or without a leading slash (e.g., 'clear' or '/clear').`));
		console.log(colors.formatInfo(`Use '/exit' to quit.`));
		console.log(colors.formatInfo(`Press Tab for command completion.`));
		console.log(colors.border(80));
		this.showPrompt();

		await this.startReading();
	}

	/**
	 * Shutdown the shell
	 */
	private async shutdown(): Promise<void> {
		this.isRunning = false;
		// Restore terminal
		await Deno.stdin.setRaw(false);
		console.log('\n' + colors.formatSuccess('Shutting down...'));
		Deno.exit(0);
	}
}
