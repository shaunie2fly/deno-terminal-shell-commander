/**
 * Terminal Shell - A modular terminal shell implementation for Deno
 * 
 * This module exports the complete public API for the terminal shell, including:
 * - Shell: The main shell class for creating terminal interfaces
 * - Command: The command interface for defining shell commands
 * - ShellServer: For exposing shells over network connections
 * - ShellClient: For connecting to remote shells
 * 
 * @module
 */
// Core Shell exports
export { Shell } from "./src/shell/Shell.ts";
export type { ShellOptions, ShellEvent, EventHandler } from "./src/shell/types.ts";

// Command system exports
export type { Command, CommandContext, CommandState } from "./src/commands/types.ts"; // Added CommandContext
export { CommandRegistry } from "./src/commands/Registry.ts";

// Remote shell exports 
export { ShellServer } from "./src/remote/server.ts";
export { ShellClient } from "./src/remote/client.ts";
export { InteractiveShellClient } from './src/remote/InteractiveClient.ts';
export type { ShellServerOptions } from "./src/remote/server.ts";
export type { ShellClientOptions } from "./src/remote/client.ts";
export { 
  AuthType, 
  MessageType, 
  ServerEvent, 
  ClientEvent 
} from "./src/remote/protocol.ts";
export type { 
  AuthOptions, 
  AuthCredentials, 
  Connection 
} from "./src/remote/protocol.ts";

// Output processing
export { 
  createOutputStream,
  pipeOutputTransformers,
  createStringStream,
  streamToString
} from "./src/output/stream.ts";

export { 
  createColorStripTransformer,
  createTrimTransformer,
  createTruncateTransformer,
  createLineNumberTransformer,
  createPrefixTransformer,
  createFilterTransformer,
  createTableTransformer,
  createCustomTransformer
} from "./src/output/transformers.ts";

// Legacy output transformers (for backward compatibility)
export {
  PrefixTransformer,
  FilterTransformer,
  TimestampTransformer,
  errorTransformer,
  warningTransformer,
  successTransformer,
  infoTransformer
} from "./src/output/transformers.ts";