/**
 * Types and interfaces for the Command system
 * @module
 */
import * as rt from 'runtypes';

import type { Shell } from '../shell/Shell.ts'; // Import Shell type for context
import type { OutputOptions } from '../shell/types.ts'; // Import OutputOptions
/**
 * Command state interface
 */
export interface CommandState {
	status: string;
	metadata: Record<string, unknown>;
}

/**
 * Context object passed to command actions.
 */
export interface CommandContext {
	shell: Shell; // Reference to the shell instance
	write: (content: string, options?: OutputOptions) => void; // Method to write output
	// Add other context properties as needed (e.g., args, services)
}


/**
 * Command interface
 */
export interface Command {
	/**
	 * The name of the command
	 */
	name: string;

	/**
	 * A description of what the command does
	 */
	description: string;

	/**
	 * The action to execute when the command is invoked
	 */
	action: (context: CommandContext, ...args: string[]) => void | Promise<void>; // Action now receives context and string args

	/**
	 * Optional subcommands
	 */
	subcommands?: Map<string, Command>;

	/**
	 * Optional initialization hook for complex commands
	 */
	init?: () => Promise<void>;

	/**
	 * Optional cleanup hook for complex commands
	 */
	cleanup?: () => Promise<void>;

	/**
	 * Optional health check for command status
	 */
	healthCheck?: () => Promise<boolean>;

	/**
	 * Optional state for stateful commands
	 */
	state?: CommandState;

	/**
	 * Optional function to provide suggestions for command arguments.
	 * Called when the user presses Tab after typing the command/subcommand name.
	 * @param context - The command execution context.
	 * @param currentArgs - The arguments already typed after the command/subcommand.
	 * @param partialArg - The current argument fragment being typed.
	 * @returns An array of suggestion strings, or a promise resolving to an array.
	 */
	getArgumentSuggestions?: (
		context: CommandContext,
		currentArgs: string[],
		partialArg: string
	) => Promise<string[]> | string[];
}

/**
 * Command validator using runtypes
 */
export const CommandStateRT = rt.Record({
	status: rt.String.withConstraint((s) => s.length > 0 || 'Status cannot be empty'),
	metadata: rt.Dictionary(rt.Unknown),
});

/**
 * Command execution result
 */
export interface CommandResult {
	success: boolean;
	output?: string;
	error?: Error;
}
