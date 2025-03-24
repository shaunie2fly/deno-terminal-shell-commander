import { ScreenBuffer, ScreenRegion } from '../buffer/screen_buffer.ts';

/**
 * Layout structure representing different screen areas
 */
interface ScreenLayout {
	output: ScreenRegion;
	input: ScreenRegion;
	status?: ScreenRegion;
}

/**
 * Manages terminal screen layout and buffer placement
 */
export class LayoutManager {
	private outputBuffer: ScreenBuffer;
	private inputBuffer: ScreenBuffer;
	private statusBuffer?: ScreenBuffer;
	private terminalSize: { width: number; height: number };
	private promptLength = 0; // Track prompt length for cursor positioning
	private currentInputLength = 0; // Track current input length for cursor
	private readonly ESC = String.fromCharCode(27); // Escape character for ANSI sequences
	private isScrolling = false; // Track if we're in scroll mode
	private scrollOffset = 0; // Current scroll position

	constructor() {
		// Get actual terminal size if available
		this.terminalSize = this.getActualTerminalSize();

		// Create initial layout
		const layout = this.calculateLayout();

		// Initialize buffers
		this.outputBuffer = new ScreenBuffer(layout.output);
		this.inputBuffer = new ScreenBuffer(layout.input);
		if (layout.status) {
			this.statusBuffer = new ScreenBuffer(layout.status);
		}
	}

	/**
	 * Get actual terminal dimensions if available
	 */
	private getActualTerminalSize(): { width: number; height: number } {
		try {
			// Try to get the actual console size
			const consoleSize = Deno.consoleSize();
			return {
				width: consoleSize.columns,
				height: consoleSize.rows,
			};
		} catch (_e) {
			// Fall back to default size if console size unavailable
			return {
				width: 80,
				height: 24,
			};
		}
	}

	/**
	 * Calculate screen layout based on terminal dimensions
	 */
	private calculateLayout(): ScreenLayout {
		const { width, height } = this.terminalSize;

		// Reserve bottom line for input
		const inputHeight = 1;
		// Reserve second-to-last line for status if terminal is tall enough
		const statusHeight = height > 10 ? 1 : 0;
		// Rest goes to output
		const outputHeight = height - inputHeight - statusHeight;

		const layout: ScreenLayout = {
			output: {
				x: 0,
				y: 0,
				width,
				height: outputHeight,
			},
			input: {
				x: 0,
				y: height - inputHeight,
				width,
				height: inputHeight,
			},
		};

		if (statusHeight > 0) {
			layout.status = {
				x: 0,
				y: height - inputHeight - statusHeight,
				width,
				height: statusHeight,
			};
		}

		return layout;
	}

	/**
	 * Update terminal dimensions and recalculate layout
	 */
	updateTerminalSize(width: number, height: number): void {
		this.terminalSize = { width, height };
		const layout = this.calculateLayout();

		// Update buffer regions
		this.outputBuffer.updateRegion(layout.output);
		this.inputBuffer.updateRegion(layout.input);
		if (layout.status && this.statusBuffer) {
			this.statusBuffer.updateRegion(layout.status);
		}
	}

	/**
	 * Write content to the output buffer
	 */
	writeOutput(content: string): void {
		// Reset scrolling when new content is written
		this.resetScroll();
		this.outputBuffer.write(content);
	}

	/**
	 * Handle cursor positioning and visibility
	 */
	private updateCursorPosition(stdout: { writeSync: (p: Uint8Array) => number }, show = true): void {
		const inputRegion = this.inputBuffer.getRegion();
		const cursorX = inputRegion.x + this.promptLength + this.currentInputLength + 1;
		const cursorY = inputRegion.y + 1;

		// Combine cursor positioning and visibility into a single command
		const command = `${this.ESC}[${cursorY};${cursorX}H${this.ESC}[?25${show ? 'h' : 'l'}`;
		stdout.writeSync(new TextEncoder().encode(command));
	}

	/**
	 * Update input buffer content
	 */
	updateInput(content: string): void {
		this.inputBuffer.clear();
		this.inputBuffer.write(content);

		// Extract prompt length and input length for cursor positioning
		const promptMatch = content.match(/^.*[>:]\s/);
		if (promptMatch) {
			this.promptLength = promptMatch[0].length;
			this.currentInputLength = content.length - this.promptLength;
		}
	}

	/**
	 * Update input buffer content without full render
	 */
	updateInputOnly(content: string): void {
		// Update content and lengths
		this.updateInput(content);

		// Hide cursor while updating
		this.updateCursorPosition(Deno.stdout, false);

		// Render input buffer
		this.inputBuffer.render(Deno.stdout);

		// Show cursor at correct position
		this.updateCursorPosition(Deno.stdout, true);
	}

	/**
	 * Update input buffer content with cursor at specific position
	 */
	updateInputWithCursor(content: string, cursorPosition: number): void {
		// Update content
		this.updateInput(content);

		// Hide cursor while updating
		this.setCursorVisibility(Deno.stdout, false);

		// Render input buffer
		this.inputBuffer.render(Deno.stdout);

		// Show cursor at specified position
		this.setCursorVisibility(Deno.stdout, true);

		// Position the cursor at the specified position
		const inputRegion = this.inputBuffer.getRegion();
		const cursorX = inputRegion.x + cursorPosition + 1;
		const cursorY = inputRegion.y + 1;

		// Move cursor to the calculated position
		const command = `${this.ESC}[${cursorY};${cursorX}H`;
		Deno.stdout.writeSync(new TextEncoder().encode(command));
	}

	/**
	 * Set cursor visibility
	 */
	private setCursorVisibility(stdout: { writeSync: (p: Uint8Array) => number }, visible: boolean): void {
		const command = `${this.ESC}[?25${visible ? 'h' : 'l'}`;
		stdout.writeSync(new TextEncoder().encode(command));
	}

	/**
	 * Update status line if available
	 */
	updateStatus(content: string): void {
		if (this.statusBuffer) {
			this.statusBuffer.clear();
			this.statusBuffer.write(content);
		}
	}

	/**
	 * Scroll output buffer up (show older content)
	 */
	scrollOutputUp(lines = 1): void {
		// Save current viewport start position to check if scrolling actually happened
		const oldViewportStart = this.outputBuffer.getViewportStart();

		// When scrolling up, we want to show older content (which is now at the beginning of the buffer)
		this.outputBuffer.scrollUp(lines);

		// Get new position to determine how far we actually scrolled
		const newViewportStart = this.outputBuffer.getViewportStart();

		// Only increment scroll offset by the actual lines scrolled
		const actualLinesScrolled = oldViewportStart - newViewportStart;
		this.scrollOffset += actualLinesScrolled;

		this.isScrolling = true;
		this.updateScrollIndicator();
	}

	/**
	 * Scroll output buffer down (show newer content)
	 */
	scrollOutputDown(lines = 1): void {
		// When scrolling down, we want to show newer content (which is now toward the end of the buffer)
		this.outputBuffer.scrollDown(lines);
		this.scrollOffset = Math.max(0, this.scrollOffset - lines);
		this.isScrolling = this.scrollOffset > 0;
		this.updateScrollIndicator();
	}

	/**
	 * Reset scrolling to show most recent output
	 */
	resetScroll(): void {
		if (this.isScrolling) {
			// Set viewport to show the newest content at the bottom
			this.outputBuffer.resetViewport();
			this.isScrolling = false;
			this.scrollOffset = 0;
			this.updateScrollIndicator();
		}
	}

	/**
	 * Update the status bar with scroll indicator if scrolling
	 */
	private updateScrollIndicator(): void {
		if (this.statusBuffer) {
			if (this.isScrolling) {
				const scrollMsg = `[SCROLL MODE: ${this.scrollOffset} lines up | Press ESC to return]`;
				this.updateStatus(scrollMsg);
			} else {
				this.updateStatus(''); // Clear scroll indicator when not scrolling
			}
		}
	}

	/**
	 * Handle key inputs for scrolling operations
	 * @param key The key that was pressed
	 * @returns True if the key was handled for scrolling, false otherwise
	 */
	handleScrollKeys(key: Uint8Array): boolean {
		const keyString = new TextDecoder().decode(key);

		// Check for escape key to exit scroll mode
		if (keyString === '\x1B' && this.isScrolling) {
			this.resetScroll();
			this.render(Deno.stdout);
			return true;
		}

		// Check for Page Up/Down keys (ANSI sequences)
		if (keyString === '\x1B[5~') { // Page Up
			this.scrollOutputUp(this.terminalSize.height - 2);
			this.render(Deno.stdout);
			return true;
		}
		if (keyString === '\x1B[6~') { // Page Down
			this.scrollOutputDown(this.terminalSize.height - 2);
			this.render(Deno.stdout);
			return true;
		}

		// Check for Arrow Up/Down with Shift modifier
		if (keyString === '\x1B[1;2A') { // Shift + Up Arrow
			this.scrollOutputUp(1);
			this.render(Deno.stdout);
			return true;
		}
		if (keyString === '\x1B[1;2B') { // Shift + Down Arrow
			this.scrollOutputDown(1);
			this.render(Deno.stdout);
			return true;
		}

		return false;
	}

	/**
	 * Clear all buffers
	 */
	clear(): void {
		this.outputBuffer.clear();
		this.inputBuffer.clear();
		if (this.statusBuffer) {
			this.statusBuffer.clear();
		}
	}

	/**
	 * Clear the output buffer only
	 */
	clearOutput(): void {
		this.outputBuffer.clear();
	}

	/**
	 * Render all buffers to the terminal
	 */
	render(stdout: { writeSync: (p: Uint8Array) => number }): void {
		// Hide cursor while rendering
		this.updateCursorPosition(stdout, false);

		// Clear the entire screen
		stdout.writeSync(new TextEncoder().encode(`${this.ESC}[2J${this.ESC}[H`));

		// Render each buffer in sequence
		this.outputBuffer.render(stdout);
		if (this.statusBuffer) {
			this.statusBuffer.render(stdout);
		}
		this.inputBuffer.render(stdout);

		// Show cursor at correct position
		this.updateCursorPosition(stdout, true);
	}
}
