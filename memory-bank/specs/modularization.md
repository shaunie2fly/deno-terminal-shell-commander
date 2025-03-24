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
└── ui/               # UI components
    ├── layout/       # Layout management
    └── buffer/       # Screen buffer handling
```

### 1.2 Export Strategy
- Create a main entry point (`mod.ts`) exporting public APIs
- Use explicit versioning for public interfaces
- Implement proper TypeScript declarations
- Support tree-shaking for optimal bundling

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

### 5.1 Phase 1: Core Restructuring (2 weeks)
1. Create unified command system
2. Implement instance-based registry
3. Add lifecycle and state support to commands

### 5.2 Phase 2: API Development (1 week)
1. Design and implement public APIs
2. Create TypeScript declarations
3. Add event system

### 5.3 Phase 3: Documentation (1 week)
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

- Phase 1 (Core): 2 weeks
- Phase 2 (API): 1 week
- Phase 3 (Docs): 1 week

Total estimated time: 4 weeks