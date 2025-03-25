/**
 * @terminal-shell - Modular Terminal Shell Framework
 *
 * A reusable terminal shell module for creating interactive command-line interfaces
 * that can be embedded in other applications or run standalone.
 *
 * @module
 */

// Export core components
export * from './shell/Shell.ts';
export * from './shell/types.ts';
export * from './commands/Registry.ts';
export * from './commands/types.ts';
export * from './ui/buffer/screen_buffer.ts';
export * from './ui/layout/layout_manager.ts';

// Export remote connectivity components
export * from './remote/server.ts';
export * from './remote/client.ts';
export * from './remote/protocol.ts';

// Export output handling
export * from './output/stream.ts';
export * from './output/transformers.ts';
