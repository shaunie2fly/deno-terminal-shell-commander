import { commandRegistry } from './commands.ts';
import * as colors from './colors.ts';
import { LayoutManager } from './ui/layout/layout_manager.ts';

const decoder = new TextDecoder();

// Key codes
const UP_ARROW = 'A';
const DOWN_ARROW = 'B';
const TAB = 9; // ASCII code for Tab key
const CTRL_C = '';

/**
 * Interface for shell component configuration
 */
interface ShellConfig {
	name?: string;
	prompt?: string;
	width?: number;
	height?: number;
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
	private layout: LayoutManager;

	constructor(config: ShellConfig = {}) {
		this.name = config.name ?? 'Terminal Shell';
		this.prompt = config.prompt ?? '> ';
		this.layout = new LayoutManager();
	}

	/**
	 * Write content to the output buffer
	 */
	public writeOutput(content: string): void {
	  this.layout.writeOutput(content);
	  // Don't immediately render after each write - we'll render once at the end
	  this.layout.render(Deno.stdout);
	}
	
	/**
	 * Internal write method for shell operations
	 */
	private write(content: string): void {
	  this.layout.writeOutput(content);
	  // Don't immediately render after each write - we'll render once at the end
	}

	/**
	 * Clear the terminal screen
	 */
	public clearScreen(): void {
		this.layout.clear();
		this.layout.render(Deno.stdout);
	}

	/**
	 * Display the prompt
	 */
	private showPrompt(): void {
		this.layout.updateInput(this.prompt + this.buffer);
		this.layout.render(Deno.stdout);
	}

	/**
	 * Update the current buffer and display
	 */
	private updateBuffer(newContent: string): void {
		this.buffer = newContent;
		this.layout.updateInput(this.prompt + this.buffer);
		this.layout.render(Deno.stdout);
	}

	/**
	 * Update the buffer for individual character input without full redraw
	 */
	private updateBufferChar(newContent: string): void {
		this.buffer = newContent;
		this.layout.updateInputOnly(this.prompt + this.buffer);
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
				// Use full render here as we're changing context
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
	 */
	private handleTabCompletion(): void {
		const input = this.buffer.trim();

		// Skip tab completion if buffer is empty
		if (!input) return;

		// Handle commands with or without leading slash
		const commandInput = input.startsWith('/') ? input.substring(1) : input;

		// Check if input is a complete command name with no space after it
		const isCompleteCommand = !commandInput.includes(' ') && commandRegistry.getCommands().has(commandInput);

		// If this is a complete command with no space, and it has subcommands, show help
		if (isCompleteCommand) {
			const command = commandRegistry.getCommands().get(commandInput);
			if (command?.subcommands && command.subcommands.size > 0) {
				// Show subcommand help
				this.write('\n');
				const helpTitle = colors.formatHelpTitle(`Available subcommands for '${commandInput}':`);
				this.write(helpTitle + '\n');

				// Calculate the maximum length for formatting
				const maxLength = Math.max(...Array.from(command.subcommands.keys()).map((s) => s.length));

				// Show each subcommand with its description
				for (const [name, subCmd] of command.subcommands) {
					const formattedCommand = colors.formatHelpCommand(name.padEnd(maxLength + 2));
					const formattedDescription = colors.formatHelpDescription(subCmd.description);
					this.write(`  ${formattedCommand}${formattedDescription}\n`);
				}

				// Render here before showing prompt
				this.layout.render(Deno.stdout);
				this.showPrompt();
				return;
			}
		}

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

			// Display all suggestions
			this.displaySuggestions(suggestions, commandInput);

			// Render here to show suggestions
			this.layout.render(Deno.stdout);

			// Handle common prefix completion
			const currentCommandPart = commandInput.split(/\s+/).pop() || '';
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
					this.updateBuffer(prefixWithSlash);
					return;
				}
			} else if (commonPrefix.length > commandInput.length) {
				const prefixToUse = input.startsWith('/') ? `/${commonPrefix}` : commonPrefix;
				this.updateBuffer(prefixToUse);
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

		if (isSubcommandSuggestion) {
			// Subcommand suggestions
			this.write(colors.formatHelpTitle('Available options:') + '\n');
			const maxLength = Math.max(...suggestions.map((s) => s.length));

			for (const suggestion of suggestions) {
				const description = commandRegistry.getSubcommandDescription(suggestion);
				const formattedCommand = colors.formatHelpCommand(suggestion.padEnd(maxLength + 2));
				const formattedDescription = description ? colors.formatHelpDescription(description) : '';
				this.write(`  ${formattedCommand}${formattedDescription}\n`);
			}
		} else {
			// Basic command suggestions
			this.write(colors.formatHelpTitle('Available commands:') + '\n');
			const maxLength = Math.max(...suggestions.map((s) => s.length));
			const columns = Math.floor(80 / (maxLength + 4)); // Assume 80 column terminal width

			if (suggestions.length > 6) {
				// Show in columns without descriptions
				let row = [];
				for (let i = 0; i < suggestions.length; i++) {
					row.push(colors.formatHelpCommand(suggestions[i].padEnd(maxLength + 2)));
					if (row.length === columns || i === suggestions.length - 1) {
						this.write('  ' + row.join('') + '\n');
						row = [];
					}
				}
			} else {
				// Show with descriptions
				for (const cmd of suggestions) {
					const description = commandRegistry.getDescription(cmd);
					const formattedCommand = colors.formatHelpCommand(cmd.padEnd(maxLength + 2));
					const formattedDescription = description ? colors.formatHelpDescription(description) : '';
					this.write(`  ${formattedCommand}${formattedDescription}\n`);
				}
			}
		}
	}

	/**
	 * Handle user input
	 */
	private async handleInput(input: string): Promise<void> {
		const command = input.trim();

		// If empty command, just show prompt
		if (!command) {
			if (this.isRunning) {
				this.showPrompt();
			}
			return;
		}

		// Only add to history if unique and non-empty
		if (command && (!this.history.length || this.history[this.history.length - 1] !== command)) {
			this.history.push(command);
		}

		// Reset history navigation
		this.historyIndex = -1;
		this.tempBuffer = '';

		// Handle built-in commands first
		if (command === '/exit') {
			await this.shutdown();
			return;
		} else if (command === '/clear' || command === 'clear') {
			this.clearScreen();
			this.showPrompt();
			return;
		}

		// Check if command starts with a slash and remove it for execution
		const commandToExecute = command.startsWith('/') ? command.substring(1) : command;
		
		// Don't clear output for help command or its variations
		const isHelpCommand = commandToExecute === 'help' || commandToExecute.startsWith('help ');
		
		// Only clear output if it's not a help command
		if (!isHelpCommand) {
		    this.layout.clearOutput();
		}
		
		// Try executing the command
		const success = await commandRegistry.executeCommand(commandToExecute);
		
		// Handle command failure
		if (!success) {
			const suggestions = commandRegistry.getSuggestions(commandToExecute);
			const errorMessage = suggestions.length > 0
				? colors.formatError('Unknown command', `"${command}"`, `Did you mean "${suggestions[0]}"?`) + '\n'
				: colors.formatError('Unknown command', `"${command}"`) + '\n';

			this.write(errorMessage);
		}

		// Render the updated output
		this.layout.render(Deno.stdout);

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
			this.layout.updateInput(this.prompt + this.buffer);
			this.layout.render(Deno.stdout);
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
				if (escapeState === 0 && char === '\x1B') {
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
					// On enter key, process the command
					const command = this.buffer.trim();
					if (command && (!this.history.length || this.history[this.history.length - 1] !== command)) {
						this.history.push(command);
					}
					this.historyIndex = -1;
					this.tempBuffer = '';
					this.write('\n'); // Add a newline for command execution
					this.buffer = '';
					await this.handleInput(command);
				} else if (char === CTRL_C) {
					this.write('^C\n');
					this.buffer = '';
					this.historyIndex = -1;
					this.showPrompt();
				} else if (char === '\b' || charCode === 127) { // Backspace (^H or DEL)
					if (this.buffer.length > 0) {
						this.buffer = this.buffer.slice(0, -1);
						// Use the optimized update for character changes
						this.updateBufferChar(this.buffer);
					}
				} else if (charCode === TAB) { // Tab key
					this.handleTabCompletion();
				} else if (char >= ' ') { // Printable characters
					this.buffer += char;
					// Use the optimized update for character changes
					this.updateBufferChar(this.buffer);
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
		} catch (error: unknown) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			this.write(colors.formatError('Terminal Error', `Failed to set raw mode: ${errorMessage}`) + '\n');
			return;
		}

		this.isRunning = true;
		this.clearScreen();

		// Batch welcome message content together
		// Write welcome message
		const welcomeMessage = [
		  colors.header(`Welcome to ${this.name}`),
		  colors.border(80),
		  colors.formatInfo(`Commands can be entered with or without a leading slash (e.g., 'clear' or '/clear').`),
		  colors.formatInfo(`Use '/exit' to quit.`),
		  colors.formatInfo(`Press Tab for command completion.`),
		  colors.border(80),
		].join('\n') + '\n';
		
		// Write and render in one go
		this.write(welcomeMessage);
		this.layout.render(Deno.stdout);
		
		// Show prompt without re-rendering everything
		this.layout.updateInputOnly(this.prompt);
		await this.startReading();
	}

	/**
	 * Shutdown the shell
	 */
	private async shutdown(): Promise<void> {
		this.isRunning = false;
		// Restore terminal
		await Deno.stdin.setRaw(false);
		this.write('\n' + colors.formatSuccess('Shutting down...') + '\n');
		Deno.exit(0);
	}
}
