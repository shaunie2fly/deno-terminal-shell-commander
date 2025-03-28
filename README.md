# @deno-terminal-shell-commander


A Deno module providing a framework for building interactive terminal applications with a client-server architecture.

**Key Features:**

*   Define custom commands with descriptions, parameters, and actions.
*   Support for nested subcommands.
*   Built-in argument parsing and validation.
*   Remote access via `ShellServer` and `ShellClient`.
*   `InteractiveShellClient` for a seamless interactive terminal experience.
*   Basic authentication support.

## Installation / Import

Import the necessary components from the module URL. It's recommended to import from a specific tagged release for stability. Check the repository for the latest release tag.

```typescript
// Example using main branch (potentially unstable):
import {
  ShellServer,
  InteractiveShellClient,
  Command,
  CommandContext,
  AuthType,
  ClientEvent,
  ParsedArguments // Import if needed in command actions
} from "https://raw.githubusercontent.com/shaunie2fly/deno-terminal-shell-commander/main/mod.ts";
```

## Core Concepts

*   **`ShellServer`**: The main class for the server-side. It manages client connections, handles command registration, parsing, execution, and authentication.
*   **`InteractiveShellClient`**: A convenient wrapper around `ShellClient` that automatically handles setting up raw mode, piping standard input/output, and managing the connection lifecycle for an interactive session.
*   **`Command`**: An interface used to define the structure of a command, including its `name`, `description`, `parameters` (options and arguments), `subcommands`, and the `action` function that contains the execution logic.
*   **`CommandContext`**: An object passed to a command's `action` function. It provides methods like `context.write()` to send output back to the connected client and access to command state.

## Server Usage Example

Here's how to set up a basic `ShellServer` with custom commands:

```typescript
import { ShellServer, AuthType } from "https://raw.githubusercontent.com/shaunie2fly/deno-terminal-shell-commander/main/mod.ts";
import type { Command, CommandContext } from "https://raw.githubusercontent.com/shaunie2fly/deno-terminal-shell-commander/main/mod.ts";
import type { ParsedArguments } from "https://raw.githubusercontent.com/shaunie2fly/deno-terminal-shell-commander/main/src/commands/parser.ts"; // Adjust path if needed

// --- Define Commands ---

// Simple command
const timeCommand: Command = {
    name: 'time',
    description: 'Displays the current server time.',
    action: (context: CommandContext) => {
        const now = new Date();
        context.write(`Current server time: ${now.toLocaleTimeString()}\r\n`);
    },
};

// Command with parameters and subcommands
const echoNormalCommand: Command = {
    name: 'normal',
    description: 'Echoes the provided text.',
	parameters: [
		{ name: 'string', alias: 's', description: 'The text to echo', type: 'string', required: true }
	],
	action: (context: CommandContext, parsedArgs: ParsedArguments) => {
		const textToEcho = parsedArgs.options['string'];
		if (typeof textToEcho !== 'string' || textToEcho.length === 0) {
			context.write(`Error: Missing or invalid --string option.\r\n`, { format: 'error' });
			return;
		}
		context.write(`${textToEcho}\r\n`);
	},
};

const echoReverseCommand: Command = {
    name: 'reverse',
    description: 'Echoes the provided text in reverse.',
    parameters: [
        { name: 'string', alias: 's', description: 'The text to reverse', type: 'string', required: true }
    ],
    action: (context: CommandContext, parsedArgs: ParsedArguments) => {
        const textToReverse = parsedArgs.options['string'];
        if (typeof textToReverse !== 'string' || textToReverse.length === 0) {
            context.write(`Error: Missing or invalid --string option.\r\n`, { format: 'error' });
            return;
        }
        const output = textToReverse.split('').reverse().join('');
        context.write(`${output}\r\n`);
    },
};

const echoCommand: Command = {
    name: 'echo',
    description: 'Echoes text normally or reversed.',
    // Optional: Default action if just 'echo' is typed
    action: (context: CommandContext, parsedArgs: ParsedArguments) => {
        if (!parsedArgs.helpRequested) {
             context.write('Usage: echo <normal|reverse> --string=<text>\r\n');
        }
    },
    subcommands: new Map<string, Command>([
        [echoNormalCommand.name, echoNormalCommand],
        [echoReverseCommand.name, echoReverseCommand],
    ]),
    // Optional: Suggest subcommands
    getArgumentSuggestions: (_context, currentArgs, partialArg) => {
        const possibleArgs = ['normal', 'reverse'];
        if (currentArgs.length === 0) {
            return possibleArgs.filter(arg => arg.startsWith(partialArg));
        }
        return [];
    },
};

// --- Create and Start Server ---

const server = new ShellServer({
    port: 8080,
    defaultPrompt: 'example> ', // Set your desired prompt
    // Basic Auth: Requires password hashing (e.g., using Deno's std/crypto)
    // Example hash for password 'pass' (SHA-256):
    auth: {
        type: AuthType.BASIC,
        users: [{ username: 'user', passwordHash: 'd74ff0ee8da3b9806b18c877dbf29bbde50b5bd8e4dad7a3a725000feb82e8f1' }]
    },
    baseCommands: [timeCommand, echoCommand], // Register top-level commands
});

console.log(`Shell server listening on port ${server.options.port}...`);
await server.start(); // Start listening for connections
```

**Note on Authentication:** For `AuthType.BASIC`, you **must** provide the `passwordHash` (e.g., SHA-256) of the user's password, not the plain text password.

## Interactive Client Usage Example

The `InteractiveShellClient` provides a simple way to connect to the `ShellServer` and interact with it from a terminal.

```typescript
import { ClientEvent, InteractiveShellClient } from "https://raw.githubusercontent.com/shaunie2fly/deno-terminal-shell-commander/main/mod.ts";

console.log('Starting Interactive Remote Shell Client...');

// Configure connection details and credentials
const interactiveClient = new InteractiveShellClient({
    host: 'localhost',
    port: 8080,
    auth: { username: 'user', password: 'pass' } // Plain text password for client
});

// --- Optional: Listen to client events ---
interactiveClient.on(ClientEvent.CONNECT, (payload) => {
	console.log('[InteractiveClient] Connected:', payload);
});

interactiveClient.on(ClientEvent.DISCONNECT, (payload) => {
	console.log('[InteractiveClient] Disconnected:', payload);
	// InteractiveShellClient handles raw mode cleanup. Exit the script.
	Deno.exit(0);
});

interactiveClient.on(ClientEvent.ERROR, (payload) => {
	console.error('[InteractiveClient] Error:', payload);
	// Decide if the application should exit on error
});

// --- Start the Interactive Client ---
(async () => {
	try {
		// start() connects, authenticates, enables raw mode, and pipes I/O
		await interactiveClient.start();
		console.log('[InteractiveClient] Session started. Type commands or Ctrl+C / "exit" to quit.');
	} catch (error) {
		console.error('[InteractiveClient] Failed to start session:', error);
		Deno.exit(1);
	}
	// The script remains active while the connection is open.
})();
```

The `InteractiveShellClient` handles entering/exiting raw mode and piping your terminal's input/output to the remote server automatically.

## License

This project is licensed under the [MIT License](LICENSE).