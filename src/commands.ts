/**
 * Interface for command registration options
 */
export interface CommandOptions {
	description: string;
	action: () => void | Promise<void>;
	subcommands?: Map<string, CommandOptions>; // Support for subcommands
}

/**
 * Command registry for managing shell commands
 */
export class CommandRegistry {
	private commands: Map<string, CommandOptions>;

	constructor() {
		this.commands = new Map();
	}

	/**
	 * Register a new command
	 */
	register(name: string, options: CommandOptions): void {
		this.commands.set(name, options);
	}

	/**
	 * Execute a command
	 */
	async executeCommand(commandName: string): Promise<boolean> {
		// Split command by spaces to handle potential subcommands
		const parts = commandName.split(/\s+/);
		const rootCommand = parts[0];

		const command = this.commands.get(rootCommand);
		if (!command) {
			return false;
		}

		// If command has subcommands and more parts exist, try to execute the subcommand
		if (command.subcommands && parts.length > 1) {
			const subcommandName = parts[1];
			const subcommand = command.subcommands.get(subcommandName);

			if (subcommand) {
				await subcommand.action();
				return true;
			}

			// If specified subcommand not found, show an error message
			console.log(`Unknown subcommand '${subcommandName}' for command '${rootCommand}'`);

			// Show available subcommands
			console.log(`Available subcommands for '${rootCommand}':`);
			for (const [name, cmd] of command.subcommands) {
				console.log(`  ${name.padEnd(12)} ${cmd.description}`);
			}

			return false;
		}

		// Execute the main command
		await command.action();
		return true;
	}

	/**
	 * Get possible command suggestions for a partial command
	 *
	 * @param partial - Partial command input to find suggestions for
	 * @param commandPath - Optional array of command parts for contextual completion
	 * @returns Array of command suggestions
	 */
	getSuggestions(partial: string, commandPath: string[] = []): string[] {
		// Regular command completion for the base case
		if (commandPath.length === 0) {
			// Full command (might contain spaces)
			const parts = partial.split(/\s+/);

			// Handle the case where the user wants to see all options for a command
			// This happens when the input ends with a space
			const endsWithSpace = partial.endsWith(' ');

			// If we have a root command followed by a space, show all available subcommands
			if (endsWithSpace && parts.length > 0) {
				const rootCommand = parts[0];
				const command = this.commands.get(rootCommand);

				// If we have a valid root command and it has subcommands
				if (command && command.subcommands && command.subcommands.size > 0) {
					const subcommandSuggestions: string[] = [];

					// Return all subcommands as suggestions
					for (const name of command.subcommands.keys()) {
						// Return full command path for each suggestion
						subcommandSuggestions.push(`${rootCommand} ${name}`);
					}

					return subcommandSuggestions;
				}
			}

			// If multiple parts but not ending with space, try contextual completion for the partial subcommand
			if (parts.length > 1) {
				const rootCommand = parts[0];
				const command = this.commands.get(rootCommand);

				// If we have a valid root command and it has subcommands
				if (command && command.subcommands) {
					const subcommandPartial = parts[1];
					const subcommandSuggestions: string[] = [];

					// Find matching subcommands
					for (const name of command.subcommands.keys()) {
						if (name.startsWith(subcommandPartial)) {
							// Return full command path for each suggestion
							subcommandSuggestions.push(`${rootCommand} ${name}`);
						}
					}

					return subcommandSuggestions;
				}
			}

			// Basic command completion for single-word inputs
			const suggestions: string[] = [];
			for (const name of this.commands.keys()) {
				if (name.startsWith(partial)) {
					suggestions.push(name);
				}
			}
			return suggestions;
		}

		// Advanced contextual completion when commandPath is provided
		// This will be used for deeper nesting of commands
		return [];
	}

	/**
	 * Get command description
	 */
	getDescription(commandName: string): string | undefined {
		return this.commands.get(commandName)?.description;
	}

	/**
	 * Get subcommand description
	 *
	 * @param commandPath - The full command path (e.g., "service start")
	 * @returns The description of the subcommand or undefined if not found
	 */
	getSubcommandDescription(commandPath: string): string | undefined {
		const parts = commandPath.split(/\s+/);
		if (parts.length < 2) return undefined;

		const rootCommand = parts[0];
		const subcommand = parts[1];

		const command = this.commands.get(rootCommand);
		if (!command || !command.subcommands) return undefined;

		return command.subcommands.get(subcommand)?.description;
	}

	/**
	 * Get all registered commands
	 */
	getCommands(): Map<string, CommandOptions> {
		return this.commands;
	}
}

// Create and export default registry instance
export const commandRegistry = new CommandRegistry();
