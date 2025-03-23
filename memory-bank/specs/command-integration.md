# Command Integration Guide

## Overview

The Terminal Shell uses a command registry system that enables easy integration of new commands. Commands can be executed with or without a leading slash (e.g., 'help' or '/help') and support features like tab completion and subcommands.

## Command Structure

### Basic Command Interface

```typescript
interface CommandOptions {
    description: string;           // Command description shown in help
    action: () => void | Promise<void>; // Command implementation
    subcommands?: Map<string, CommandOptions>; // Optional subcommands
}
```

## Adding New Commands

### 1. Basic Command Registration

```typescript
import { commandRegistry } from './commands.ts';

// Register a simple command
commandRegistry.register('hello', {
    description: 'Displays a greeting',
    action: () => {
        console.log('Hello, world!');
    }
});
```

### 2. Commands with Subcommands

```typescript
// Create a command with subcommands
const serviceCommand = new Map<string, CommandOptions>();

serviceCommand.set('start', {
    description: 'Start the service',
    action: async () => {
        // Implementation
    }
});

serviceCommand.set('stop', {
    description: 'Stop the service',
    action: async () => {
        // Implementation
    }
});

// Register the main command with its subcommands
commandRegistry.register('service', {
    description: 'Manage services',
    action: () => {
        // Optional: Implement default action when no subcommand is provided
        console.log('Use "service [start|stop]" to manage services');
    },
    subcommands: serviceCommand
});
```

## Command Integration Best Practices

1. **Clear Descriptions**
   - Provide concise but informative descriptions
   - Include example usage in complex cases
   - Document any parameters or options

2. **Error Handling**
   - Implement proper error handling in actions
   - Provide clear error messages to users
   - Consider edge cases and invalid inputs

3. **Async Operations**
   - Use async/await for asynchronous operations
   - Handle promise rejections appropriately
   - Show progress indicators for long-running tasks

4. **Subcommand Organization**
   - Group related functionality under a single command
   - Use consistent naming conventions
   - Implement help/usage information for complex command groups

## Command Features

### Tab Completion
- The shell provides automatic tab completion for commands and subcommands
- Displays command descriptions when showing suggestions
- Supports partial matches and common prefix completion

### Command History
- Commands are automatically added to history
- Up/Down arrows navigate through command history
- History persists during the session

### Background Process Support
- Commands can be run in the background using the `bg` command
- Background processes are managed by the TaskManager system
- Each background process gets a unique ID for tracking
- Users can continue working in the shell while background processes run
- Process status can be monitored using the `ps` command
- Background processes can be terminated using the `kill` command

Example usage:
```bash
# Start a long-running process in background
bg npm run dev    # Returns: process-1679556789012

# List running processes
ps
# Output:
# process-1679556789012: npm run dev (running)

# Continue working while the process runs
# ... execute other commands ...

# When finished, terminate the process
kill process-1679556789012
```

## Example Implementations

### 1. Simple Status Command
```typescript
commandRegistry.register('status', {
    description: 'Show system status',
    action: async () => {
        const status = await getSystemStatus();
        console.log(`System Status: ${status}`);
    }
});
```

### 2. Complex Command with Subcommands
```typescript
// Create subcommands
const configCommands = new Map<string, CommandOptions>();

configCommands.set('get', {
    description: 'Get configuration value',
    action: async () => {
        // Implementation
    }
});

configCommands.set('set', {
    description: 'Set configuration value',
    action: async () => {
        // Implementation
    }
});

// Register main command
commandRegistry.register('config', {
    description: 'Manage configuration',
    action: () => {
        console.log('Available commands: config get, config set');
    },
    subcommands: configCommands
});
```

## Integration Testing

1. **Test Command Registration**
   - Verify command is properly registered
   - Check description is set correctly
   - Validate subcommands if applicable

2. **Test Command Execution**
   - Test basic command functionality
   - Verify error handling
   - Check subcommand routing

3. **Test Tab Completion**
   - Verify command appears in suggestions
   - Check subcommand completion
   - Test partial matches

## Common Patterns

1. **Service Commands**
   - Use start/stop/restart subcommands
   - Implement status checking
   - Handle service dependencies

2. **Configuration Commands**
   - Use get/set/list subcommands
   - Support different configuration scopes
   - Validate configuration values

3. **Resource Management**
   - Use create/delete/list subcommands
   - Implement resource validation
   - Handle resource dependencies

4. **Background Process Management**
   - Use `bg` command for background execution
   - Monitor process status with `ps`
   - Terminate processes with `kill`
   - Track process completion and status