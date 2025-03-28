/**
 * Command Registry implementation for the shell
 * @module
 */
import type { Command, CommandContext, CommandResult } from './types.ts'; // Import necessary types
import { parseArguments } from './parser.ts'; // Import the parser function and type

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
	// TODO: Implement this method in Phase 5
	private _generateHelp(command: Command): string {
	 let help = `${command.description}\n\nUsage: ${command.name}`;
	 if (command.parameters && command.parameters.length > 0) {
	 	help += ' [options]';
	 }
	 if (command.subcommands && command.subcommands.size > 0) {
	 	help += ' <subcommand>';
	 }
	 help += '\n';

	 if (command.parameters && command.parameters.length > 0) {
	 	help += '\nOptions:\n';
	 	command.parameters.forEach(p => {
	 		const alias = p.alias ? `-${p.alias}, ` : '';
	 		const req = p.required ? ' (required)' : '';
	 		help += `  ${alias}--${p.name}${req}\t${p.description}\n`;
	 	});
	 }

	 if (command.subcommands && command.subcommands.size > 0) {
	 	help += '\nSubcommands:\n';
	 	command.subcommands.forEach(sub => {
	 		help += `  ${sub.name}\t${sub.description}\n`;
	 	});
	 }
	 return help;
	}

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

			// --- Argument Parsing ---
			const parsedArgs = parseArguments(currentArgs, commandToExecute.parameters);

			// Handle parsing errors
			if (parsedArgs.errors.length > 0) {
				const errorMsg = `Argument errors:\n${parsedArgs.errors.map((e: string) => `  - ${e}`).join('\n')}`; // Add type to 'e'
				context.write(errorMsg, { format: 'error', newline: true });
				// Optionally show help on error:
				// context.write(this._generateHelp(commandToExecute), { newline: true });
				return { success: false, error: new Error(errorMsg) };
			}

			// Handle help request
			if (parsedArgs.helpRequested) {
				context.write(this._generateHelp(commandToExecute), { newline: true });
				return { success: true }; // Successfully showed help
			}
			// --- End Argument Parsing ---

			// Execute the found command/subcommand action with parsed args
			// NOTE: This will cause a type error until Phase 4 is complete (updating action signature)
			await commandToExecute.action(context, parsedArgs);
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
	 * Get command/argument suggestions based on partial input.
	 * @param partial - The partial command input string.
	 * @param context - The command execution context.
	 * @returns Promise resolving to an array of suggestion strings.
	 */
	public async getSuggestions(partial: string, context: CommandContext): Promise<string[]> {
		const trimmedPartial = partial.trimStart(); // Keep trailing space if present
		const parts = trimmedPartial.split(/\s+/);
		// If the input is just spaces, parts will be [""] or ["", ""], handle this.
		const validParts = parts.filter(p => p.length > 0);
		const endsWithSpace = partial.length > 0 && /\s$/.test(partial);

		if (validParts.length === 0 && !endsWithSpace) {
			// Empty input: suggest all top-level commands
			return Array.from(this.commands.keys());
		}

		// --- Find deepest matching command/subcommand ---
		let commandCandidate: Command | undefined = undefined;
		let commandPathParts: string[] = [];
		let argStartIndex = 0; // Index in validParts where arguments start

		if (validParts.length > 0) {
			const rootCommand = this.commands.get(validParts[0]);
			if (rootCommand) {
				commandCandidate = rootCommand;
				commandPathParts = [validParts[0]];
				argStartIndex = 1;
				for (let i = 1; i < validParts.length; i++) {
					const subName = validParts[i];
					if (commandCandidate.subcommands && commandCandidate.subcommands.has(subName)) {
						commandCandidate = commandCandidate.subcommands.get(subName);
						commandPathParts.push(subName);
						argStartIndex = i + 1;
					} else {
						break; // Remaining parts are arguments
					}
					if (!commandCandidate) break; // Should not happen
				}
			}
		}
		// --- End find command ---

		const commandCandidatePath = commandPathParts.join(' ');
		const currentArgs = validParts.slice(argStartIndex);


		// --- Determine suggestions based on context ---
		if (endsWithSpace) {
			// CASE 1: Input ends with space - Suggest next argument or subcommand

			// 1a: Try getting argument suggestions for the *next* argument
			if (commandCandidate && commandCandidate.getArgumentSuggestions) {
				try {
					const argSuggestions = await commandCandidate.getArgumentSuggestions(context, currentArgs, ""); // Empty partial for next arg
					if (argSuggestions && argSuggestions.length > 0) {
						// Return suggestions as they are. Shell needs to handle insertion.
						return argSuggestions;
					}
				} catch (error) {
					console.error(`[CommandRegistry] Error getting argument suggestions for ${commandCandidatePath}:`, error);
				}
			}

			// 1b: If no argument suggestions, suggest subcommands of the current command
			if (commandCandidate && commandCandidate.subcommands && commandCandidate.subcommands.size > 0) {
				return Array.from(commandCandidate.subcommands.keys()).map(subName => `${commandCandidatePath} ${subName}`);
			}

			// 1c: Nothing to suggest
			return [];

		} else {
			// CASE 2: Input does NOT end with space - Complete current word

			const partialLastWord = validParts[validParts.length - 1] || "";
			const isPotentiallySubcommand = commandCandidate && argStartIndex === validParts.length - 1; // Is the word being typed potentially a subcommand?
			const isPotentiallyArgument = commandCandidate && argStartIndex <= validParts.length - 1; // Is the word being typed potentially an argument?

			// 2a: Try completing as a subcommand first
			if (isPotentiallySubcommand && commandCandidate?.subcommands) {
				const subSuggestions = Array.from(commandCandidate.subcommands.keys())
					.filter(subName => subName.startsWith(partialLastWord))
					.map(subName => `${commandCandidatePath} ${subName}`);
				if (subSuggestions.length > 0) {
					return subSuggestions;
				}
			}

			// 2b: If not a matching subcommand, try completing as an argument
			if (isPotentiallyArgument && commandCandidate?.getArgumentSuggestions) {
				try {
					const argsBeforePartial = currentArgs.slice(0, -1);
					const argSuggestions = await commandCandidate.getArgumentSuggestions(context, argsBeforePartial, partialLastWord);
					if (argSuggestions && argSuggestions.length > 0) {
						// Filter suggestions by the partial word and return only the values
						const filtered = argSuggestions.filter(s => s.startsWith(partialLastWord));
						if (filtered.length > 0) {
							return filtered;
						}
					}
				} catch (error) {
					console.error(`[CommandRegistry] Error getting argument suggestions for ${commandCandidatePath}:`, error);
				}
			}

			// 2c: If not subcommand or argument, and it's the first word, try completing as a top-level command
			if (validParts.length === 1 && argStartIndex === 0) {
				const topLevelSuggestions = Array.from(this.commands.keys())
					.filter(name => name.startsWith(partialLastWord));
				if (topLevelSuggestions.length > 0) {
					return topLevelSuggestions;
				}
			}

			// 2d: Nothing to suggest
			return [];
		}
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
