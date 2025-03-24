# Terminal Scrolling Functionality

## Overview

The terminal shell now supports scrolling through the output buffer history, allowing users to view content that has scrolled off-screen. This document describes the implementation of this feature and how to use it.

## User Interface

Users can navigate through the terminal's output history using the following key combinations:

- **Page Up**: Scroll up by one page (terminal height - 2 lines)
- **Page Down**: Scroll down by one page (terminal height - 2 lines)
- **Shift + Up Arrow**: Scroll up one line at a time
- **Shift + Down Arrow**: Scroll down one line at a time
- **ESC**: Exit scroll mode and return to the most recent output

When in scroll mode, a status indicator appears at the bottom of the screen showing the current scroll position and instructions for exiting scroll mode.

## Implementation Details

### Buffer Management

The implementation leverages the existing `ScreenBuffer` class, which already supported scrolling through a viewport:

1. The buffer stores 10 screens worth of history:
   ```typescript
   const maxLines = this.region.height * 10; // Keep 10 screens worth of history
   ```

2. The buffer maintains a viewport that represents the currently visible portion of the buffer:
   ```typescript
   export interface ViewPort {
     start: number; // Starting line index
     size: number; // Number of visible lines
   }
   ```

3. The scrolling is implemented by adjusting the viewport's starting position:
   ```typescript
   scrollUp(lines = 1): void {
     const maxStart = Math.max(0, this.lines.length - this.viewport.size);
     this.viewport.start = Math.min(maxStart, this.viewport.start + lines);
   }
   
   scrollDown(lines = 1): void {
     this.viewport.start = Math.max(0, this.viewport.start - lines);
   }
   ```

### Layout Manager Integration

The `LayoutManager` class was enhanced to:

1. Track scroll state with new properties:
   ```typescript
   private isScrolling = false; // Track if we're in scroll mode
   private scrollOffset = 0;    // Current scroll position
   ```

2. Provide methods to handle scrolling:
   ```typescript
   scrollOutputUp(lines = 1): void
   scrollOutputDown(lines = 1): void
   resetScroll(): void
   ```

3. Show a status indicator when scrolling is active:
   ```typescript
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
   ```

4. Handle key inputs for scrolling operations:
   ```typescript
   handleScrollKeys(key: Uint8Array): boolean
   ```

### Shell Integration

The main `Shell` class was updated to:

1. Check for scroll-related key inputs first in the input handling loop:
   ```typescript
   // Check if this is a scroll-related key first
   if (this.layout.handleScrollKeys(buffer.subarray(0, n))) {
     // Key was handled by scroll handler
     continue;
   }
   ```

2. Reset scrolling when new output is written or commands are entered
   ```typescript
   writeOutput(content: string): void {
     // Reset scrolling when new content is written
     this.resetScroll();
     this.outputBuffer.write(content);
   }
   ```

3. Inform users about scrolling capabilities in the welcome message

## Design Considerations

1. **Discoverability**: The scrolling functionality is explicitly mentioned in the welcome message to make users aware of it.

2. **Visual Feedback**: When in scroll mode, a status indicator appears showing the current position and how to exit.

3. **Context Preservation**: The input line remains visible and functional even when scrolling, maintaining user context.

4. **Automatic Reset**: Scrolling is automatically reset when new output is generated or commands are entered.

5. **Memory Management**: The buffer maintains a reasonable history size (10 screens worth) to balance usability and memory usage.

## Future Enhancements

Potential improvements to consider:

1. Adding a scrollbar or position indicator on the right side of the terminal
2. Supporting horizontal scrolling for wide content
3. Adding search functionality within the scrollback buffer
4. Allowing users to configure the amount of history to maintain
5. Supporting mouse wheel scrolling when terminal emulation permits