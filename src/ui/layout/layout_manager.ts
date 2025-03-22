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
   * Update status line if available
   */
  updateStatus(content: string): void {
    if (this.statusBuffer) {
      this.statusBuffer.clear();
      this.statusBuffer.write(content);
    }
  }

  /**
   * Scroll output buffer up
   */
  scrollOutputUp(lines = 1): void {
    this.outputBuffer.scrollUp(lines);
  }

  /**
   * Scroll output buffer down
   */
  scrollOutputDown(lines = 1): void {
    this.outputBuffer.scrollDown(lines);
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
