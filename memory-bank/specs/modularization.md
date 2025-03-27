# Shell Module Modularization Plan

## Overview
This document outlines the plan to convert the terminal shell application into a reusable module that can be imported into other projects, using a unified command-based architecture.

## 1. Module Architecture

### 1.1 Core Components
```
@terminal-shell/
├── shell/              # Core shell functionality
│   ├── Shell.ts       # Main shell class
│   └── types.ts       # Shell interfaces and types
├── commands/          # Unified command system
│   ├── Registry.ts    # Command registration
│   └── types.ts       # Command interfaces
├── ui/               # UI components
│   ├── layout/       # Layout management
│   └── buffer/       # Screen buffer handling
└── remote/           # Remote shell connectivity
    ├── server.ts     # Shell server for remote connections
    ├── client.ts     # Shell client for connecting to remote shells
    └── protocol.ts   # Shared protocol definitions
```

## 2. Public API Surface

### 2.1 Core Shell API
```typescript
export interface ShellOptions {
  name?: string;
  prompt?: string;
  width?: number;
  height?: number;
  commands?: Command[];
}

export class Shell {
  constructor(options: ShellOptions);
  
  // Core methods
  start(): Promise<void>;
  stop(): Promise<void>;
  
  // Command management
  registerCommand(command: Command): void;
  unregisterCommand(name: string): void;
  
  // Output control
  write(content: string): void;
  clear(): void;
  
  // Events
  on(event: ShellEvent, handler: EventHandler): void;
  off(event: ShellEvent, handler: EventHandler): void;
}

export interface Command {
  name: string;
  description: string;
  action: (...args: unknown[]) => void | Promise<void>;
  subcommands?: Map<string, Command>;
  
  // Optional lifecycle hooks (for complex commands)
  init?: () => Promise<void>;
  cleanup?: () => Promise<void>;
  healthCheck?: () => Promise<boolean>;
  state?: {
    status: string;
    metadata: Record<string, unknown>;
  };
}
```

### 2.2 Remote Shell API
```typescript
export interface ShellServerOptions {
  shell: Shell;
  port?: number;
  host?: string;
  socketPath?: string;
  auth?: AuthOptions;
}

export class ShellServer {
  constructor(options: ShellServerOptions);
  
  // Core methods
  start(): Promise<void>;
  stop(): Promise<void>;
  
  // Connection management
  getConnections(): Connection[];
  disconnectAll(): Promise<void>;
  
  // Events
  on(event: ServerEvent, handler: EventHandler): void;
}

export interface ShellClientOptions {
  port?: number;
  host?: string;
  socketPath?: string;
  auth?: AuthCredentials;
}

export class ShellClient {
  constructor(options: ShellClientOptions);
  
  // Core methods
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  
  // Shell interaction
  executeCommand(command: string): Promise<CommandResult>;
  
  // Stream handling
  getOutputStream(): ReadableStream<string>;
  getInputStream(): WritableStream<string>;
  
  // Events
  on(event: ClientEvent, handler: EventHandler): void;
}
```

## 3. Integration Examples

### 3.1 Simple Command
```typescript
import { Shell } from "@terminal-shell/mod.ts";

const shell = new Shell({
  name: "Custom Shell",
  prompt: "custom> "
});

// Simple stateless command
shell.registerCommand({
  name: "greet",
  description: "Say hello",
  action: () => shell.write("Hello!\n")
});
```

### 3.2 Command Group
```typescript
// Command with subcommands
shell.registerCommand({
  name: "help",
  description: "Show help information",
  action: () => shell.write("Available topics:\n  commands\n  usage\n"),
  subcommands: new Map([
    ["commands", { 
      name: "commands",
      description: "List all commands",
      action: () => listCommands()
    }],
    ["usage", {
      name: "usage",
      description: "Show usage examples",
      action: () => showUsage()
    }]
  ])
});
```

### 3.3 Complex Stateful Command
```typescript
// Complex command with lifecycle and state (formerly a service)
shell.registerCommand({
  name: "fs",
  description: "File system operations",
  action: () => showFsHelp(),
  subcommands: new Map([
    ["list", { 
      name: "list",
      description: "List files in directory",
      action: () => listFiles()
    }],
    ["read", {
      name: "read",
      description: "Read file contents",
      action: (path) => readFile(path)
    }]
  ]),
  // Lifecycle hooks
  init: async () => {
    // Initialize file system access
  },
  cleanup: async () => {
    // Cleanup resources
  },
  // State management
  state: {
    status: "ready",
    metadata: {
      workingDirectory: Deno.cwd()
    }
  }
});
```

### 3.4 Remote Shell Server
```typescript
import { Shell, ShellServer } from "@terminal-shell/mod.ts";

// Create a shell instance
const shell = new Shell({
  name: "Service Shell",
  prompt: "service> "
});

// Register commands specific to this service
shell.registerCommand({
  name: "status",
  description: "Show service status",
  action: () => shell.write(`Service running: ${getServiceStatus()}\n`)
});

// Create a server to expose the shell
const server = new ShellServer({
  shell,
  port: 8888, // TCP port
  // or use socketPath for IPC
  // socketPath: "/tmp/service-shell.sock",
  auth: {
    type: "basic",
    users: [{ username: "admin", passwordHash: "..." }]
  }
});

// Start the server
await server.start();
console.log("Shell server running on port 8888");

// In your service's shutdown procedure:
await server.stop();
```

### 3.5 Remote Shell Client
```typescript
import { ShellClient } from "@terminal-shell/mod.ts";

// Connect to a remote shell
const client = new ShellClient({
  host: "localhost",
  port: 8888,
  auth: {
    username: "admin",
    password: "secret"
  }
});

// Connect to the remote shell
await client.connect();

// Get output stream and pipe to console
const outputStream = client.getOutputStream();
(async () => {
  for await (const chunk of outputStream) {
    console.log(chunk);
  }
})();

// Send commands to the remote shell
const result = await client.executeCommand("status");
console.log("Command result:", result);

// Handle connection events
client.on("disconnect", () => {
  console.log("Disconnected from shell server");
});

// When done
await client.disconnect();
```

## 4. Breaking Changes and Migration

### 4.1 Breaking Changes
1. Replace global registry with instance-based registry
2. Remove service system in favor of enhanced commands
3. Update command registration interface

### 4.2 Migration Strategy
1. Simple commands remain unchanged
2. Convert services to command groups with lifecycle hooks
3. Move service state to command state
4. Provide compatibility utilities for transition

## 5. Implementation Plan

### 5.1 Phase 1: Core Restructuring 
1. Create unified command system
2. Implement instance-based registry
3. Add lifecycle and state support to commands

### 5.2 Phase 2: API Development
1. Design and implement public APIs
2. Create TypeScript declarations
3. Add event system

### 5.3 Phase 3: Documentation
1. API documentation
2. Migration guides with examples
3. Best practices for different command types

## 6. Testing Strategy

### 6.1 Unit Tests
- Core shell functionality
- Command registration and execution
- Command lifecycle hooks
- State management
- UI components

### 6.2 Integration Tests
- Command groups and hierarchies
- State transitions
- Event handling
- Real-world command patterns

## 7. Next Steps

1. Create new repository structure
2. Implement unified command system
3. Build shell instance management
4. Write migration documentation

## 8. Timeline

- Phase 1 (Core): 
- Phase 2 (API): 
- Phase 3 (Docs): 

## 9. Dependency Management

### 9.1 External Dependencies
- Use import maps in deno.json for all external dependencies
- Provide version pinning options for consumers
- Document compatibility requirements

### 9.2 Internal Dependencies
- Create clear module boundaries to prevent circular dependencies
- Implement dependency injection for better testability
- Use factory patterns for component creation

## 10. Configuration System

### 10.1 Shell Configuration
- Support progressive configuration (defaults, files, environment, runtime)
- Implement validation using runtypes
- Enable configuration hot-reloading

### 10.2 Command Configuration
- Allow commands to declare their configuration schema
- Implement configuration inheritance and overrides
- Enable per-command persistence options

## 11. Extension Mechanisms

### 11.1 Plugin System
- Provide plugin loading API for third-party extensions
- Define plugin lifecycle events and hooks
- Support asynchronous plugin discovery

### 11.2 Middleware Architecture
- Implement middleware support for command processing
- Allow for pre/post command execution hooks
- Create a logging middleware example

## 12. Event System

### 12.1 Core Events
- shell:start, shell:stop
- command:register, command:unregister
- command:before, command:after, command:error

### 12.2 Custom Events
- Enable commands to define and emit custom events
- Implement event bubbling and capturing
- Support typed event payloads

## 13. Runtime Type Safety

### 13.1 Command Parameter Validation
- Define parameter schemas using runtypes
- Implement automatic validation before command execution
- Provide helpful error messages for invalid inputs

### 13.2 State Validation
- Validate state mutations with runtypes
- Implement runtime type checking for all external inputs
- Create migration utilities for state schema changes

## 14. Examples Repository

### 14.1 Migration Examples
- Basic command migration
- Service-to-command conversion examples
- State management migration patterns

### 14.2 Integration Examples
- Custom shell implementation
- Extension development
- Plugin creation
- Advanced command patterns

## 16. Remote Shell Protocol

### 16.1 Connection Types
- TCP socket for network connectivity
- Unix domain socket for local IPC
- WebSocket for browser-based clients
- Custom protocol adapters for extensibility

### 16.2 Protocol Format
- JSON-based message protocol
- Support for binary data streaming
- Command/response pattern with correlation IDs
- Event notifications

### 16.3 Authentication Methods
- Basic auth (username/password)
- Token-based authentication
- Custom authentication providers
- Permission levels for command access

### 16.4 Security Considerations
- TLS encryption for network connections
- Connection rate limiting
- Command access control lists
- Audit logging for all connections and commands

