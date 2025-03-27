/**
 * Command Registry implementation for the shell
 * @module
 */
import { Command, CommandContext, CommandResult } from './types.ts'; // Import CommandContext

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
			// Optionally allow overwriting or warn instead of throwing
			console.warn(`[CommandRegistry] Warning: Command '${command.name}' is being overwritten.`);
			// throw new Error(`Command '${command.name}' is already registered`);
		}

		// Initialize the command if it has an init method
		if (command.init) {
			// We don't await the init here, as it might be long-running
			// The command should handle its own initialization state
			command.init().catch((error) => {
				console.error(`[CommandRegistry] Error initializing command '${command.name}':`, error);
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
				console.error(`[CommandRegistry] Error cleaning up command '${name}':`, error);
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
	 * Get a subcommand from a command path.
	 * @param commandPath - The full path to the subcommand (e.g., "fs list").
	 * @returns The subcommand if found, undefined otherwise.
	 */
	public getSubcommand(commandPath: string): Command | undefined {
		const parts = commandPath.trim().split(/\s+/);
		if (parts.length === 0) return undefined;

		let currentCommand = this.commands.get(parts[0]);
		if (!currentCommand) return undefined;

		for (let i = 1; i < parts.length; i++) {
			if (!currentCommand.subcommands) return undefined;
			const subName = parts[i];
			const subcommand = currentCommand.subcommands.get(subName);
			if (!subcommand) return undefined;
			currentCommand = subcommand;
		}
		// Only return if we traversed beyond the root command
		return parts.length > 1 ? currentCommand : undefined;
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
		const parts = commandPath.trim().split(/\s+/);
		if (parts.length < 2) return ''; // Subcommands need at least two parts

		let currentCommand = this.commands.get(parts[0]);
		if (!currentCommand) return '';

		for (let i = 1; i < parts.length; i++) {
			if (!currentCommand.subcommands) return '';
			const subName = parts[i];
			const subcommand = currentCommand.subcommands.get(subName);
			if (!subcommand) return '';
			currentCommand = subcommand;
		}

		return currentCommand.description || '';
	}


	/**
	 * Execute a command or subcommand based on the input string.
	 * Parses the input, finds the correct command/subcommand, and executes its action.
	 * @param commandInput - The command to execute, including any arguments (e.g., "help", "fs list /tmp").
	 * @param context - The execution context containing shell reference and write method.
	 * @returns Promise resolving to a result object with success status and potential error.
	 */
	public async executeCommand(
		commandInput: string,
		context: CommandContext, // Add context parameter
	): Promise<CommandResult> {
		const trimmedInput = commandInput.trim();
		if (!trimmedInput) {
			return { success: false, error: new Error('Empty command') };
		}

		try {
			const parts = trimmedInput.split(/\s+/);
			const commandName = parts[0];
			const args = parts.slice(1);

			let commandToExecute: Command | undefined = this.commands.get(commandName);
			let currentArgs = args;

			// Traverse subcommand hierarchy if arguments exist
			let depth = 0; // To track how many parts were consumed as subcommands
			while (commandToExecute?.subcommands && currentArgs.length > 0 && commandToExecute.subcommands.has(currentArgs[0])) {
				const subName = currentArgs[0];
				commandToExecute = commandToExecute.subcommands.get(subName);
				currentArgs = currentArgs.slice(1); // Consume the subcommand name from args
				depth++;
				if (!commandToExecute) {
					// This path should ideally not be reached if .has() works, but defensively:
					return { success: false, error: new Error(`Invalid subcommand path near '${subName}'`) };
				}
			}

			// If no command (top-level or sub) was found
			if (!commandToExecute) {
				return {
					success: false,
					error: new Error(`Unknown command or subcommand path: ${commandInput}`),
				};
			}

			// Execute the found command/subcommand action
			await commandToExecute.action(context, ...currentArgs); // Pass context and remaining args
			return { success: true };

		} catch (error) {
			console.error(`[CommandRegistry] Error executing command "${commandInput}":`, error);
			return {
				success: false,
				error: error instanceof Error ? error : new Error(String(error)),
			};
		}
	}

	/**
	 * Get command suggestions based on partial input
	 * @param partial - The partial command input
	 * @returns Array of matching command names or subcommand paths
	 */
	public getSuggestions(partial: string): string[] {
		const parts = partial.trim().split(/\s+/);
		const suggestions: string[] = [];

		if (parts.length === 0) return [];

		// If only one part, suggest top-level commands
		if (parts.length === 1) {
			const partialCmd = parts[0];
			for (const name of this.commands.keys()) {
				if (name.startsWith(partialCmd)) {
					suggestions.push(name);
				}
			}
			return suggestions;
		}

		// If multiple parts, try suggesting subcommands
		const commandName = parts[0];
		let currentCommand = this.commands.get(commandName);
		if (!currentCommand) return []; // Base command doesn't exist

		let currentPath = commandName;
		for (let i = 1; i < parts.length; i++) {
			const part = parts[i];
			const isLastPart = (i === parts.length - 1);

			if (!currentCommand?.subcommands) return []; // No more subcommands down this path

			if (isLastPart) {
				// Suggest subcommands starting with the last part
				for (const subName of currentCommand.subcommands.keys()) {
					if (subName.startsWith(part)) {
						suggestions.push(`${currentPath} ${subName}`);
					}
				}
				return suggestions; // Return suggestions at this level
			} else {
				// Navigate deeper
				const nextCommand = currentCommand.subcommands.get(part);
				if (!nextCommand) return []; // Invalid path part
				currentCommand = nextCommand;
				currentPath += ` ${part}`;
			}
		}

		return suggestions; // Should technically be unreachable if logic is correct
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
					console.error(`[CommandRegistry] Health check failed for command '${name}':`, error);
					healthStatuses.set(name, false);
				}
			}
			// Optionally add check for subcommands recursively if needed
		}

		return healthStatuses;
	}
}
