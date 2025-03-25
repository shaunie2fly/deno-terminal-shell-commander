/**
 * Command Registry implementation for the shell
 * @module
 */
import { Command, CommandResult } from './types.ts';

/**
 * Registry for shell commands with instance-based registration
 */
export class CommandRegistry {
	private commands: Map<string, Command>;

	/**
	 * Create a new command registry
	 * @param initialCommands - Optional array of commands to register at creation
	 */
	constructor(initialCommands: Command[] = []) {
		this.commands = new Map<string, Command>();

		// Register initial commands if provided
		for (const command of initialCommands) {
			this.registerCommand(command);
		}
	}

	/**
	 * Register a command with the registry
	 * @param command - The command to register
	 * @throws Error if a command with the same name is already registered
	 */
	public registerCommand(command: Command): void {
		if (this.commands.has(command.name)) {
			throw new Error(`Command '${command.name}' is already registered`);
		}

		// Initialize the command if it has an init method
		if (command.init) {
			// We don't await the init here, as it might be long-running
			// The command should handle its own initialization state
			command.init().catch((error) => {
				console.error(`Error initializing command '${command.name}':`, error);
			});
		}

		this.commands.set(command.name, command);
	}

	/**
	 * Unregister a command from the registry
	 * @param name - The name of the command to unregister
	 * @returns True if the command was unregistered, false if it wasn't found
	 */
	public unregisterCommand(name: string): boolean {
		const command = this.commands.get(name);

		if (!command) {
			return false;
		}

		// Run cleanup if available
		if (command.cleanup) {
			// We don't await the cleanup here, but we should log errors
			command.cleanup().catch((error) => {
				console.error(`Error cleaning up command '${name}':`, error);
			});
		}

		return this.commands.delete(name);
	}

	/**
	 * Get all registered commands
	 * @returns Map of command names to command objects
	 */
	public getCommands(): Map<string, Command> {
		return new Map(this.commands);
	}

	/**
	 * Get a command by name
	 * @param name - The name of the command to get
	 * @returns The command if found, undefined otherwise
	 */
	public getCommand(name: string): Command | undefined {
		return this.commands.get(name);
	}

	/**
	 * Get a subcommand from a command
	 * @param commandPath - The path to the subcommand (e.g., "fs list")
	 * @returns The subcommand if found, undefined otherwise
	 */
	public getSubcommand(commandPath: string): Command | undefined {
		const parts = commandPath.trim().split(/\s+/);
		if (parts.length === 0) return undefined;

		// Get the root command
		let currentCommand = this.commands.get(parts[0]);
		if (!currentCommand) return undefined;

		// Navigate through the subcommand hierarchy
		for (let i = 1; i < parts.length; i++) {
			if (!currentCommand.subcommands) return undefined;

			const subcommand = currentCommand.subcommands.get(parts[i]);
			if (!subcommand) return undefined;

			currentCommand = subcommand;
		}

		return currentCommand;
	}

	/**
	 * Get the description of a command
	 * @param name - The name of the command
	 * @returns The description if the command exists, empty string otherwise
	 */
	public getDescription(name: string): string {
		const command = this.commands.get(name);
		return command?.description || '';
	}

	/**
	 * Get the description of a subcommand
	 * @param commandPath - The path to the subcommand (e.g., "fs list")
	 * @returns The description if the subcommand exists, empty string otherwise
	 */
	public getSubcommandDescription(commandPath: string): string {
		const command = this.getSubcommand(commandPath);
		return command?.description || '';
	}

	/**
	 * Execute a command
	 * @param commandInput - The command to execute, including any arguments
	 * @returns Promise resolving to a result object with success status
	 */
	public async executeCommand(commandInput: string): Promise<CommandResult> {
		const trimmedInput = commandInput.trim();
		if (!trimmedInput) {
			return { success: false, error: new Error('Empty command') };
		}

		try {
			const parts = trimmedInput.split(/\s+/);
			const commandName = parts[0];
			const args = parts.slice(1);

			// Check if this is a command with subcommands
			if (args.length > 0) {
				const subcommand = this.getSubcommand(trimmedInput);
				if (subcommand) {
					await subcommand.action();
					return { success: true };
				}
			}

			// Try to execute as a top-level command
			const command = this.commands.get(commandName);
			if (!command) {
				return {
					success: false,
					error: new Error(`Unknown command: ${commandName}`),
				};
			}

			await command.action(...args);
			return { success: true };
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}

	/**
	 * Get command suggestions based on partial input
	 * @param partial - The partial command input
	 * @returns Array of matching command names
	 */
	public getSuggestions(partial: string): string[] {
		const parts = partial.trim().split(/\s+/);

		// If we have multiple parts, try to get subcommand suggestions
		if (parts.length > 1) {
			const baseCommand = parts[0];
			const command = this.commands.get(baseCommand);

			if (command?.subcommands) {
				const _subcommandPartial = parts.slice(1).join(' ');
				const suggestions: string[] = [];

				for (const [name, _] of command.subcommands) {
					if (name.startsWith(parts[1])) {
						// If there are more parts, we need to check deeper
						if (parts.length > 2) {
							const nestedCommand = command.subcommands.get(name);
							if (nestedCommand?.subcommands) {
								// Recursively search for nested subcommands
								for (const [nestedName, _] of nestedCommand.subcommands) {
									const fullNestedName = `${baseCommand} ${name} ${nestedName}`;
									if (fullNestedName.startsWith(partial)) {
										suggestions.push(fullNestedName);
									}
								}
							}
						} else {
							suggestions.push(`${baseCommand} ${name}`);
						}
					}
				}

				return suggestions;
			}
		}

		// Top-level command suggestions
		const suggestions: string[] = [];
		for (const [name, _] of this.commands) {
			if (name.startsWith(partial)) {
				suggestions.push(name);
			}
		}

		return suggestions;
	}

	/**
	 * Check the health of all commands that implement healthCheck
	 * @returns Promise resolving to a map of command names to health status
	 */
	public async checkCommandHealth(): Promise<Map<string, boolean>> {
		const healthStatuses = new Map<string, boolean>();

		for (const [name, command] of this.commands) {
			if (command.healthCheck) {
				try {
					const isHealthy = await command.healthCheck();
					healthStatuses.set(name, isHealthy);
				} catch (error) {
					healthStatuses.set(name, false);
				}
			}
		}

		return healthStatuses;
	}
}
