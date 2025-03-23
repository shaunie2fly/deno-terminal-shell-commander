/**
 * Screen buffer implementation for terminal display
 */

const encoder = new TextEncoder();

/**
 * Represents a region of the terminal screen
 */
export interface ScreenRegion {
	x: number;
	y: number;
	width: number;
	height: number;
}

/**
 * ViewPort represents the visible portion of a buffer
 */
export interface ViewPort {
	start: number; // Starting line index
	size: number; // Number of visible lines
}

/**
 * Manages a virtual buffer for terminal screen content
 */
export class ScreenBuffer {
	private lines: string[] = [];
	private viewport: ViewPort = { start: 0, size: 0 };
	private region: ScreenRegion;

	constructor(region: ScreenRegion) {
		this.region = region;
		this.viewport.size = region.height;
	}

	/**
	 * Write content to the buffer
	 */
	write(content: string): void {
		// Handle double newlines as explicit requests for empty lines
		// Replace double newlines with a special marker temporarily
		const doubleNewlineMarker = '\uE000'; // Use a Unicode private use character as marker
		const processedContent = content.replace(/\n\n/g, doubleNewlineMarker);

		// Split content by single newlines
		const contentLines = processedContent.split('\n');

		// Process each line separately
		for (const line of contentLines) {
			if (line.includes(doubleNewlineMarker)) {
				// Handle sections with double newlines
				const segments = line.split(doubleNewlineMarker);
				for (let i = 0; i < segments.length; i++) {
					if (segments[i].length > 0) {
						// Add the content segment
						const wrappedLines = this.wrapText(segments[i], this.region.width);
						this.lines.push(...wrappedLines);
					}

					// Add an empty line after each segment except the last one
					if (i < segments.length - 1) {
						this.lines.push('');
					}
				}
			} else {
				// Normal line without double newlines
				const wrappedLines = this.wrapText(line, this.region.width);
				this.lines.push(...wrappedLines);
			}
		}

		// Maintain only as many lines as we need
		const maxLines = this.region.height * 3; // Keep 3 screens worth of history
		if (this.lines.length > maxLines) {
			this.lines = this.lines.slice(-maxLines);
		}

		// Auto-scroll to show new content
		this.viewport.start = Math.max(0, this.lines.length - this.viewport.size);
	}

	/**
	 * Clear the buffer content
	 */
	clear(): void {
		this.lines = [];
		this.viewport.start = 0;
	}

	/**
	 * Get the content within the current viewport
	 */
	getViewportContent(): string[] {
		return this.lines.slice(
			this.viewport.start,
			this.viewport.start + this.viewport.size,
		);
	}

	/**
	 * Scroll the viewport up
	 */
	scrollUp(lines = 1): void {
		this.viewport.start = Math.max(0, this.viewport.start - lines);
	}

	/**
	 * Scroll the viewport down
	 */
	scrollDown(lines = 1): void {
		const maxStart = Math.max(0, this.lines.length - this.viewport.size);
		this.viewport.start = Math.min(maxStart, this.viewport.start + lines);
	}

	/**
	 * Update the region dimensions
	 */
	updateRegion(region: ScreenRegion): void {
		this.region = region;
		this.viewport.size = region.height;

		// Re-wrap existing content for new width
		const allContent = this.lines.join('\n');
		this.lines = this.wrapText(allContent, region.width);

		// Adjust viewport if needed
		if (this.viewport.start + this.viewport.size > this.lines.length) {
			this.viewport.start = Math.max(0, this.lines.length - this.viewport.size);
		}
	}

	/**
	 * Get current region dimensions
	 */
	getRegion(): ScreenRegion {
		return { ...this.region };
	}

	/**
	 * Get ANSI commands to position cursor at region coordinates
	 */
	private getPositionCommands(lineOffset = 0): string {
		// Calculate y position based on region's starting y plus the current line offset
		const y = this.region.y + lineOffset + 1; // +1 because ANSI is 1-indexed
		const x = this.region.x + 1; // +1 because ANSI is 1-indexed
		return `\x1b[${y};${x}H`;
	}

	/**
	 * Wrap text to fit within specified width
	 */
	private wrapText(text: string, width: number): string[] {
		// If text is empty or width is 0 or less, return empty array
		if (!text || width <= 0) return [''];

		const lines: string[] = [];

		// Check if text contains ANSI escape sequences
		const hasAnsi = text.includes('\x1b[');

		if (!hasAnsi) {
			// Simple case: no ANSI sequences
			const words = text.split(/(\s+)/);
			let currentLine = '';

			for (const word of words) {
				if (currentLine.length + word.length <= width) {
					currentLine += word;
				} else if (word.trim().length > width) {
					// If current line has content, push it first
					if (currentLine.trim()) {
						lines.push(currentLine);
					}
					// Split long word across multiple lines
					for (let i = 0; i < word.length; i += width) {
						lines.push(word.slice(i, Math.min(i + width, word.length)));
					}
					currentLine = '';
				} else {
					if (currentLine.trim()) {
						lines.push(currentLine);
					}
					currentLine = word;
				}
			}

			if (currentLine.trim()) {
				lines.push(currentLine);
			}
		} else {
			// Complex case: handle ANSI sequences
			// Split by newlines first to preserve intentional line breaks
			const textLines = text.split('\n');

			for (const line of textLines) {
				if (!line) {
					lines.push('');
					continue;
				}

				let currentLine = '';
				let visibleLength = 0;
				let buffer = '';
				let inEscapeSeq = false;

				for (let i = 0; i < line.length; i++) {
					const char = line[i];

					if (char === '\x1b') {
						inEscapeSeq = true;
						buffer += char;
						continue;
					}

					if (inEscapeSeq) {
						buffer += char;
						if (char === 'm') {
							inEscapeSeq = false;
							currentLine += buffer;
							buffer = '';
						}
						continue;
					}

					if (visibleLength >= width) {
						lines.push(currentLine);
						currentLine = '';
						visibleLength = 0;
					}

					currentLine += char;
					visibleLength++;
				}

				if (currentLine) {
					lines.push(currentLine);
				}
			}
		}

		return lines.length ? lines : [''];
	}

	/**
	 * Render the buffer content to the terminal
	 */
	render(stdout: { writeSync: (p: Uint8Array) => number }): void {
		const viewportContent = this.getViewportContent();

		// First clear the entire region
		const clearCommands: string[] = [];

		// Build clear commands for the entire region
		for (let i = 0; i < this.region.height; i++) {
			clearCommands.push(`${this.getPositionCommands(i)}\x1b[2K`); // Position + clear line
		}

		// Execute all clear commands at once
		stdout.writeSync(encoder.encode(clearCommands.join('')));

		// Then render content with proper positioning
		if (viewportContent.length > 0) {
			const output = viewportContent
				.map((line, index) => {
					if (index < this.region.height) {
						// Position cursor at start of line within region and write content
						const pos = this.getPositionCommands(index);
						// Make sure the line doesn't exceed region width
						const truncatedLine = line.length > this.region.width ? line.slice(0, this.region.width) : line;
						return `${pos}${truncatedLine}`;
					}
					return '';
				})
				.filter(Boolean)
				.join('');

			if (output) {
				stdout.writeSync(encoder.encode(output));
			}
		}
	}
}
