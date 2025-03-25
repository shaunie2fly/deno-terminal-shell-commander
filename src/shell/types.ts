/**
 * Types and interfaces for the Shell module
 * @module
 */
import * as rt from 'runtypes';
import { Command } from '../commands/types.ts';

/**
 * Configuration options for the Shell
 */
export const ShellOptionsRT = rt.Record({
	name: rt.String.optional().withConstraint((s) => !s || s.length > 0 || 'Shell name cannot be empty'),
	prompt: rt.String.optional().withConstraint((s) => !s || s.length > 0 || 'Prompt cannot be empty'),
	width: rt.Number.optional().withConstraint((n) => !n || n > 0 || 'Width must be positive'),
	height: rt.Number.optional().withConstraint((n) => !n || n > 0 || 'Height must be positive'),
	commands: rt.Array(rt.Unknown).optional(),
});

/**
 * Shell configuration options
 */
export type ShellOptions = rt.Static<typeof ShellOptionsRT> & {
	commands?: Command[];
};

/**
 * Shell event types
 */
export enum ShellEventType {
	START = 'shell:start',
	STOP = 'shell:stop',
	COMMAND_BEFORE = 'command:before',
	COMMAND_AFTER = 'command:after',
	COMMAND_ERROR = 'command:error',
}

/**
 * Event handler interface
 */
export type EventHandler = (event: ShellEvent) => void;

/**
 * Shell event interface with payload
 */
export interface ShellEvent {
	type: ShellEventType;
	timestamp: number;
	payload?: unknown;
}

/**
 * Options for shell output
 */
export interface OutputOptions {
	newline?: boolean;
	format?: OutputFormat;
}

/**
 * Formatting options for shell output
 */
export type OutputFormat =
	| 'default'
	| 'success'
	| 'error'
	| 'info'
	| 'warning'
	| 'header';
