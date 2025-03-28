import { commandRegistry } from './commands.ts';
import * as colors from './colors.ts';
import { LayoutManager } from './ui/layout/layout_manager.ts';

const decoder = new TextDecoder();

// Key codes
const UP_ARROW = 'A';
const DOWN_ARROW = 'B';
const RIGHT_ARROW = 'C';
const LEFT_ARROW = 'D';
const TAB = 9; // ASCII code for Tab key
const CTRL_C = '';
const PAGE_UP = '5~';
const PAGE_DOWN = '6~';

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
 * @class Shell
 * @description Manages the terminal user interface, input handling, command execution,
 * history, tab completion, and overall shell lifecycle. It interacts with the
 * LayoutManager for rendering and the CommandRegistry for command processing.
 */
export class Shell {
	/** @property {string} buffer - The current input buffer content. */
	private buffer = '';
	/** @property {number} cursorPosition - The current position of the cursor within the input buffer. */
	private cursorPosition = 0; // Track cursor position within buffer
	/** @property {string[]} history - Stores the command history. */
	private history: string[] = [];
	/** @property {number} historyIndex - The current index when navigating through command history. -1 means not navigating. */
	private historyIndex = -1;
	/** @property {string} tempBuffer - Temporarily stores the current buffer when navigating history. */
	private tempBuffer = ''; // Store buffer when navigating history
	/** @property {string} name - The name of the shell instance, displayed in the welcome message. */
	private name: string;
	/** @property {string} prompt - The prompt string displayed before user input. */
	private prompt: string;
	/** @property {boolean} isRunning - Flag indicating if the shell is currently active and reading input. */
	private isRunning = false;
	/** @property {LayoutManager} layout - Manages the rendering of the shell UI components (output, input). */
	private layout: LayoutManager;

	/**
	 * @constructor
	 * @param {ShellConfig} [config={}] - Optional configuration for the shell.
	 * @param {string} [config.name='Terminal Shell'] - The name of the shell.
	 * @param {string} [config.prompt='> '] - The prompt string.
	 * @param {number} [config.width] - (Not currently used) Intended width for the shell layout.
	 * @param {number} [config.height] - (Not currently used) Intended height for the shell layout.
	 */
	constructor(config: ShellConfig = {}) {
		this.name = config.name ?? 'Terminal Shell';
		this.prompt = config.prompt ?? '> ';
		this.layout = new LayoutManager();
	}

	/**
	 * @public
	 * @method writeOutput
	 * @description Writes content directly to the shell's output area and triggers a render.
	 * Use this for displaying command results or messages to the user.
	 * @param {string} content - The content to write to the output.
	 */
	public writeOutput(content: string): void {
		this.layout.writeOutput(content);
		// Don't immediately render after each write - we'll render once at the end
		this.layout.render(Deno.stdout);
	}

	/**
	 * @private
	 * @method write
	 * @description Internal method to write content to the output buffer without an immediate render.
	 * Used internally by methods that perform multiple writes before a final render.
	 * @param {string} content - The content to write.
	 */
	private write(content: string): void {
		this.layout.writeOutput(content);
		// Don't immediately render after each write - we'll render once at the end
	}

	/**
	 * @public
	 * @method clearScreen
	 * @description Clears the entire terminal screen and the layout buffer, then re-renders.
	 */
	public clearScreen(): void {
		this.layout.clear();
		this.layout.render(Deno.stdout);
	}

	/**
	 * @private
	 * @method showPrompt
	 * @description Displays the shell prompt along with the current input buffer and cursor position.
	 */
	private showPrompt(): void {
		this.layout.updateInputWithCursor(this.prompt + this.buffer, this.prompt.length + this.cursorPosition);
		this.layout.render(Deno.stdout);
	}

	/**
	 * @private
	 * @method updateBuffer
	 * @description Updates the entire input buffer with new content and re-renders the input line.
	 * Use this when the entire buffer content changes (e.g., history navigation, tab completion).
	 * @param {string} newContent - The new content for the input buffer.
	 */
	private updateBuffer(newContent: string): void {
		this.buffer = newContent;
		this.layout.updateInput(this.prompt + this.buffer);
		this.layout.render(Deno.stdout);
	}

	/**
	 * @private
	 * @method updateBufferChar
	 * @description Updates the input buffer content without triggering a full render, only updating the layout's internal state.
	 * Used for single character insertions/deletions before the final cursor update and render.
	 * @param {string} newContent - The new content for the input buffer.
	 */
	private updateBufferChar(newContent: string): void {
		this.buffer = newContent;
		this.layout.updateInputOnly(this.prompt + this.buffer);
	}

	/**
	 * @private
	 * @method handleArrowKey
	 * @description Handles UP and DOWN arrow key presses for navigating command history.
	 * @param {string} key - The specific arrow key pressed ('A' for UP, 'B' for DOWN).
	 */
	private handleArrowKey(key: string): void {
		if (key === UP_ARROW) {
			if (this.historyIndex === -1) {
				this.tempBuffer = this.buffer;
			}
			if (this.historyIndex < this.history.length - 1) {
				this.historyIndex++;
				// Get the historical command
				const historyCommand = this.history[this.history.length - 1 - this.historyIndex];
				// Update buffer with full render
				this.buffer = historyCommand;
				this.cursorPosition = historyCommand.length;
				this.updateInputWithCursor(); // Renders implicitly
			}
		} else if (key === DOWN_ARROW) {
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
				this.updateInputWithCursor(); // Renders implicitly
			}
		}
	}

	/**
	 * @private
	 * @method handleTabCompletion
	 * @description Handles the Tab key press for command and subcommand completion.
	 * Provides suggestions or autocompletes based on the current input buffer.
	 */
	private handleTabCompletion(): void {
		const input = this.buffer.slice(0, this.cursorPosition); // Complete based on text before cursor

		// Skip tab completion if buffer before cursor is empty or ends with space
		if (!input || input.endsWith(' ')) return;

		// Handle commands with or without leading slash
		const commandInput = input.startsWith('/') ? input.substring(1) : input;

		// Check if input is a complete command name with no space after it
		const isCompleteCommand = !commandInput.includes(' ') && commandRegistry.getCommands().has(commandInput);

		// If this is a complete command with no space, and it has subcommands, show help
		if (isCompleteCommand) {
			const command = commandRegistry.getCommands().get(commandInput);
			if (command?.subcommands && command.subcommands.size > 0) {
				this.write('\n');

				// Build output content in an array first
				const outputLines: string[] = [];

				// Add title
				outputLines.push(colors.formatHelpTitle(`Available subcommands for '${commandInput}':`));

				// Calculate the maximum length for formatting
				const maxLength = Math.max(...Array.from(command.subcommands.keys()).map((s) => s.length));

				// Add each subcommand with its description
				for (const [name, subCmd] of command.subcommands) {
					const formattedCommand = colors.formatHelpCommand(name.padEnd(maxLength + 2));
					const formattedDescription = colors.formatHelpDescription(subCmd.description);
					outputLines.push(`  ${formattedCommand}${formattedDescription}`);
				}

				// Write all lines at once
				this.write(outputLines.join('\n') + '\n');

				// Render here before showing prompt
				this.layout.render(Deno.stdout);
				this.showPrompt();
				return;
			}
		}

		// Get command suggestions from registry based on input before cursor
		const suggestions = commandRegistry.getSuggestions(commandInput);

		if (suggestions.length === 0) {
			// No matches found, do nothing
			return;
		} else if (suggestions.length === 1) {
			// Single match - autocomplete
			// Single match - autocomplete
			const completedCommand = suggestions[0];
			const fullCompletedCommand = input.startsWith('/') ? `/${completedCommand}` : completedCommand;
			const remainingBuffer = this.buffer.slice(this.cursorPosition);
			this.buffer = fullCompletedCommand + remainingBuffer;
			this.cursorPosition = fullCompletedCommand.length; // Move cursor to end of completed part
			this.updateInputWithCursor(); // Renders implicitly
		} else if (suggestions.length > 1) {
			// Multiple matches - show suggestions and attempt common prefix completion
			this.write('\n');

			// Find common prefix for partial completion
			const commonPrefix = this.findCommonPrefix(suggestions);

			// Display all suggestions
			this.displaySuggestions(suggestions, commandInput);

			// Render here to show suggestions
			this.layout.render(Deno.stdout);

			// Handle common prefix completion
			// Attempt common prefix completion only if the prefix is longer than the current input part
			const currentPart = commandInput.split(/\s+/).pop() || '';
			if (commonPrefix.length > currentPart.length) {
				const isSubcommandCompletion = commandInput.includes(' ');
				let prefixToInsert: string;

				if (isSubcommandCompletion) {
					const parts = commandInput.split(/\s+/);
					const baseCommand = parts.slice(0, -1).join(' ');
					// Ensure the common prefix starts with the base command structure if applicable
					if (commonPrefix.startsWith(baseCommand + ' ')) {
						prefixToInsert = commonPrefix;
					} else {
						// This case might be complex, maybe just complete the subcommand part
						const subPrefix = this.findCommonPrefix(suggestions.map(s => s.substring(baseCommand.length + 1)));
						prefixToInsert = baseCommand + ' ' + subPrefix;
					}

				} else {
					prefixToInsert = commonPrefix;
				}

				const fullPrefixToInsert = input.startsWith('/') ? `/${prefixToInsert}` : prefixToInsert;
				const remainingBuffer = this.buffer.slice(this.cursorPosition);
				this.buffer = fullPrefixToInsert + remainingBuffer;
				this.cursorPosition = fullPrefixToInsert.length;
				this.updateInputWithCursor(); // Renders implicitly
				return; // Don't show prompt again if we completed
			}

			// If no common prefix completion happened, just show the prompt again
			this.showPrompt();
		}
	}

	/**
	 * @private
	 * @method findCommonPrefix
	 * @description Finds the longest common starting sequence among an array of strings.
	 * @param {string[]} strings - An array of strings.
	 * @returns {string} The longest common prefix. Returns an empty string if the array is empty or no common prefix exists.
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
	 * @private
	 * @method displaySuggestions
	 * @description Formats and writes command or subcommand suggestions to the output area.
	 * @param {string[]} suggestions - The list of suggestion strings.
	 * @param {string} _commandInput - The original input used to generate suggestions (currently unused).
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
				const description = commandRegistry.getSubcommandDescription(suggestion);
				const formattedCommand = colors.formatHelpCommand(suggestion.padEnd(maxLength + 2));
				const formattedDescription = description ? colors.formatHelpDescription(description) : '';
				outputLines.push(`  ${formattedCommand}${formattedDescription}`);
			}
		} else {
			// Basic command suggestions
			outputLines.push(colors.formatHelpTitle('Available commands:'));
			const maxLength = Math.max(...suggestions.map((s) => s.length));
			let termWidth = 80; // Default width
			try {
				termWidth = Deno.consoleSize().columns;
			} catch (_e) { /* Ignore error, use default */ }
			const columns = Math.max(1, Math.floor(termWidth / (maxLength + 4))); // Ensure at least 1 column

			// Determine if descriptions should be shown (heuristic: few items or enough space)
			const showDescriptions = suggestions.length <= 6 || columns === 1;

			if (!showDescriptions) {
				// Show in columns without descriptions
				// Show in columns without descriptions
				let row: string[] = [];
				for (let i = 0; i < suggestions.length; i++) {
					row.push(colors.formatHelpCommand(suggestions[i].padEnd(maxLength + 2)));
					if (row.length === columns || i === suggestions.length - 1) {
						outputLines.push('  ' + row.join(''));
						row = [];
					}
				}
			} else {
				// Show with descriptions (one per line)
				for (const cmd of suggestions) {
					const description = commandRegistry.getDescription(cmd);
					const formattedCommand = colors.formatHelpCommand(cmd.padEnd(maxLength + 2));
					const formattedDescription = description ? colors.formatHelpDescription(description) : '';
					// Simple wrapping for description if too long (basic)
					const availableDescWidth = termWidth - (maxLength + 4); // Width for description
					let wrappedDescription = formattedDescription;
					if (formattedDescription.length > availableDescWidth && availableDescWidth > 10) {
						// Basic wrap - split into lines
						const lines = [];
						let currentLine = '';
						formattedDescription.split(' ').forEach(word => {
							if ((currentLine + word).length > availableDescWidth) {
								lines.push(currentLine.trim());
								currentLine = word + ' ';
							} else {
								currentLine += word + ' ';
							}
						});
						lines.push(currentLine.trim());
						wrappedDescription = lines.join(`\n${' '.repeat(maxLength + 4)}`); // Indent subsequent lines
					}

					outputLines.push(`  ${formattedCommand}${wrappedDescription}`);
				}
			}
		}

		// Write all lines at once with a single newline character between each line
		this.write(outputLines.join('\n') + '\n');
	}

	/**
	 * @private
	 * @async
	 * @method handleInput
	 * @description Processes the completed user input string (after Enter is pressed).
	 * Adds command to history, handles built-in commands (/exit, /clear),
	 * executes commands via CommandRegistry, and displays errors or results.
	 * @param {string} input - The raw input string from the buffer.
	 * @returns {Promise<void>}
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

		// Try executing the command first to determine if it exists
		// We'll only clear the output if the command exists and isn't a help command
		const isHelpCommand = commandToExecute === 'help' || commandToExecute.startsWith('help ');

		// Try executing the command without clearing the output
		const success = await commandRegistry.executeCommand(commandToExecute);

		// Handle command success or failure
		if (success) {
			// Command executed successfully
			// If it wasn't a help command, we might want to clear for future commands
			if (!isHelpCommand) {
				// Don't clear after successful execution, let commands control their own output
			}
		} else {
			// Handle command failure
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
	 * @private
	 * @method handleBackspace
	 * @description Handles the Backspace key press by deleting the character before the cursor.
	 * @deprecated Use {@link deleteBeforeCursor} instead.
	 */
	private handleBackspace(): void {
		// This method is likely superseded by deleteBeforeCursor called from startReading
		if (this.cursorPosition > 0) {
			this.deleteBeforeCursor(); // Delegate to the cursor-aware method
		}
	}

	/**
	 * @private
	 * @async
	 * @method startReading
	 * @description Enters the main input loop, reading from stdin, decoding input,
	 * handling escape sequences (arrows, special keys), printable characters,
	 * backspace, tab completion, enter key, and Ctrl+C.
	 * @returns {Promise<void>} Resolves when the shell stops running or stdin closes.
	 */
	private async startReading(): Promise<void> {
		const buffer = new Uint8Array(1024);
		let escapeState = 0; // 0: normal, 1: got ESC, 2: got CSI
		let escapeBuffer = ''; // Buffer to store escape sequence characters

		while (this.isRunning) {
			const n = await Deno.stdin.read(buffer);
			if (n === null) break; // Stdin closed

			const currentInputBytes = buffer.subarray(0, n);

			// Check if this is a scroll-related key first
			// Check if this is a scroll-related key first
			if (this.layout.handleScrollKeys(currentInputBytes)) {
				// Key was handled by scroll handler, render the scrolled view
				this.layout.render(Deno.stdout);
				continue;
			}

			const input = decoder.decode(currentInputBytes);
			for (let i = 0; i < input.length; i++) {
				const char = input[i];
				const charCode = char.charCodeAt(0);

				// --- Escape Sequence Handling ---
				if (escapeState === 0 && char === '\x1B') { // ESC
					escapeState = 1;
					escapeBuffer = '\x1B';
					continue;
				}

				if (escapeState === 1) { // After ESC
					escapeBuffer += char;
					if (char === '[') { // CSI (Control Sequence Introducer)
						escapeState = 2;
					} else { // Not a CSI sequence (e.g., Alt+key) - ignore for now
						escapeState = 0;
						escapeBuffer = '';
					}
					continue;
				}

				if (escapeState === 2) { // Inside CSI sequence
					escapeBuffer += char;
					let handled = false;

					// Check for complete, known sequences ending with a letter or '~'
					if (char >= '@' && char <= '~') {
						switch (escapeBuffer) {
							case '\x1B[A': // Up Arrow
								this.handleArrowKey(UP_ARROW);
								handled = true;
								break;
							case '\x1B[B': // Down Arrow
								this.handleArrowKey(DOWN_ARROW);
								handled = true;
								break;
							case '\x1B[C': // Right Arrow
								this.moveCursorRight();
								handled = true;
								break;
							case '\x1B[D': // Left Arrow
								this.moveCursorLeft();
								handled = true;
								break;
							case '\x1B[5~': // Page Up
							case '\x1B[6~': // Page Down
								// These are handled by layout.handleScrollKeys, but we reset state here
								handled = true;
								break;
							// Add more sequences if needed (e.g., Home, End, Delete)
							// case '\x1B[H': // Home
							// case '\x1B[F': // End
							// case '\x1B[3~': // Delete
						}

						if (handled) {
							escapeState = 0;
							escapeBuffer = '';
						} else {
							// Unknown sequence ending, reset state
							escapeState = 0;
							escapeBuffer = '';
						}
					} else if (!/[0-9;]/.test(char)) {
						// Invalid character within sequence, reset state
						escapeState = 0;
						escapeBuffer = '';
					}
					// If still in sequence (e.g., waiting for numbers/semicolons), continue loop
					if (escapeState === 2) continue;
				}

				// --- Regular Input Handling (if not in escape sequence) ---
				if (escapeState === 0) {
					if (char === '\r' || char === '\n') { // Enter key
						const commandToProcess = this.buffer; // Process the whole buffer
						this.write('\n'); // Move to next line in output
						this.buffer = ''; // Clear buffer for next input
						this.cursorPosition = 0; // Reset cursor
						await this.handleInput(commandToProcess); // Process and potentially show prompt
					} else if (charCode === 3) { // Ctrl+C
						this.write('^C\n');
						this.buffer = '';
						this.cursorPosition = 0;
						this.historyIndex = -1; // Reset history navigation
						this.tempBuffer = '';
						this.showPrompt(); // Show a fresh prompt
					} else if (char === '\b' || charCode === 127) { // Backspace (ASCII 8 or 127)
						this.deleteBeforeCursor(); // Handles buffer, cursor, and rendering
					} else if (charCode === TAB) { // Tab key
						this.handleTabCompletion(); // Handles completion, suggestions, rendering
					} else if (charCode >= 32 && charCode !== 127) { // Printable characters (excluding DEL)
						this.insertAtCursor(char); // Handles buffer, cursor, and rendering
					}
					// Ignore other control characters for now
				}
			}
		}
	}

	/**
	 * @public
	 * @async
	 * @method start
	 * @description Initializes the shell, sets the terminal to raw mode, displays a welcome message,
	 * shows the initial prompt, and starts the input reading loop.
	 * @returns {Promise<void>}
	 */
	public async start(): Promise<void> {
		// Configure terminal
		try {
			// Make sure TTY properties are available
			if (Deno.stdin.isTerminal()) {
				await Deno.stdin.setRaw(true);
			} else {
				this.write(colors.formatError('Terminal Error', 'Standard input is not a TTY. Raw mode not set.') + '\n');
				// Decide if you want to exit or proceed with limited functionality
				// return;
			}
		} catch (error: unknown) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			this.write(colors.formatError('Terminal Error', `Failed to set raw mode: ${errorMessage}`) + '\n');
			return; // Exit if raw mode fails
		}

		this.isRunning = true;
		this.clearScreen(); // Initial clear

		// Batch welcome message content together
		let termWidth = 80; // Default width
		try {
			termWidth = Deno.consoleSize().columns;
		} catch (_e) { /* Ignore error, use default */ }
		const welcomeMessage = [
			colors.header(`Welcome to ${this.name}`),
			colors.border(termWidth), // Use dynamic width
			colors.formatInfo(`Commands can be entered with or without a leading slash (e.g., 'clear' or '/clear').`),
			colors.formatInfo(`Use '/exit' to quit.`),
			colors.formatInfo(`Press Tab for command completion.`),
			colors.formatInfo(`Use arrow keys (↑/↓) for history and (←/→) for cursor navigation.`),
			colors.formatInfo(`Use PageUp/PageDown or Shift+Up/Down to scroll through output history.`),
			colors.formatInfo(`Press ESC to exit scroll mode and return to most recent output.`),
			colors.border(termWidth), // Use dynamic width
		].join('\n') + '\n';

		// Write and render welcome message
		this.write(welcomeMessage);
		this.layout.render(Deno.stdout); // Render after writing welcome message

		// Show initial prompt and start reading
		this.showPrompt(); // This also renders
		await this.startReading(); // Start the input loop
	}

	/**
	 * @private
	 * @async
	 * @method shutdown
	 * @description Stops the shell, restores the terminal from raw mode, prints a shutdown message,
	 * and exits the Deno process.
	 * @returns {Promise<void>}
	 */
	private async shutdown(): Promise<void> {
		if (!this.isRunning) return; // Prevent multiple shutdowns
		this.isRunning = false;
		// Restore terminal only if it was set to raw mode
		try {
			if (Deno.stdin.isTerminal()) {
				await Deno.stdin.setRaw(false);
			}
		} catch (error: unknown) {
			// Log error but proceed with shutdown
			console.error(colors.formatError('Terminal Error', `Failed to restore terminal mode: ${error instanceof Error ? error.message : String(error)}`));
		}

		this.write('\n' + colors.formatSuccess('Shutting down...') + '\n');
		this.layout.render(Deno.stdout); // Ensure shutdown message is visible
		Deno.exit(0);
	}

	/**
	 * @private
	 * @method updateCursorPosition
	 * @description Safely updates the internal cursor position, clamping it within the bounds of the current buffer length.
	 * @param {number} newPosition - The desired new cursor position.
	 */
	private updateCursorPosition(newPosition: number): void {
		this.cursorPosition = Math.max(0, Math.min(newPosition, this.buffer.length));
	}

	/**
	 * @private
	 * @method moveCursorLeft
	 * @description Moves the cursor one position to the left, if possible, and updates the display.
	 */
	private moveCursorLeft(): void {
		if (this.cursorPosition > 0) {
			this.updateCursorPosition(this.cursorPosition - 1);
			this.updateInputWithCursor(); // Renders implicitly
		}
	}

	/**
	 * @private
	 * @method moveCursorRight
	 * @description Moves the cursor one position to the right, if possible, and updates the display.
	 */
	private moveCursorRight(): void {
		if (this.cursorPosition < this.buffer.length) {
			this.updateCursorPosition(this.cursorPosition + 1);
			this.updateInputWithCursor(); // Renders implicitly
		}
	}

	/**
	 * @private
	 * @method updateInputWithCursor
	 * @description Updates the input line display in the layout, ensuring the cursor is positioned correctly. Triggers a render.
	 */
	private updateInputWithCursor(): void {
		this.layout.updateInputWithCursor(this.prompt + this.buffer, this.prompt.length + this.cursorPosition);
		this.layout.render(Deno.stdout); // Render the change
	}

	/**
	 * @private
	 * @method insertAtCursor
	 * @description Inserts a character into the buffer at the current cursor position, updates the cursor position, and refreshes the display.
	 * @param {string} char - The character to insert.
	 */
	private insertAtCursor(char: string): void {
		const pre = this.buffer.slice(0, this.cursorPosition);
		const post = this.buffer.slice(this.cursorPosition);
		this.buffer = pre + char + post;
		this.cursorPosition++; // Move cursor after the inserted character
		this.updateInputWithCursor(); // Renders implicitly
	}

	/**
	 * @private
	 * @method deleteBeforeCursor
	 * @description Deletes the character immediately before the current cursor position, updates the cursor position, and refreshes the display.
	 */
	private deleteBeforeCursor(): void {
		if (this.cursorPosition > 0) {
			const pre = this.buffer.slice(0, this.cursorPosition - 1);
			const post = this.buffer.slice(this.cursorPosition);
			this.buffer = pre + post;
			this.cursorPosition--; // Move cursor back
			this.updateInputWithCursor(); // Renders implicitly
		}
	}
}
