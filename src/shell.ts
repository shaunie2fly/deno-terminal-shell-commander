import { commandRegistry } from './commands.ts';
import { serviceRegistry } from './services.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// ANSI control sequences
const ESC = '\x1b';
const CSI = ESC + '[';
const UP_ARROW = 'A';
const DOWN_ARROW = 'B';
const BACKSPACE_SEQUENCE = '\b \b';

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
				console.log(`Unknown command "${command}". Did you mean "${suggestions[0]}"?`);
			} else {
				console.log(`Unknown command "${command}"`);
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
			console.error('Failed to set raw mode:', error);
			return;
		}

		this.isRunning = true;
		this.clearScreen();
		console.log(`Welcome to ${this.name}. Type commands below.`);
		console.log(`Commands can be entered with or without a leading slash (e.g., 'clear' or '/clear').`);
		console.log(`Use '/exit' to quit.`);
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
		console.log('\nShutting down...');
		Deno.exit(0);
	}
}
