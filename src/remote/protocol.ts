/**
 * Remote Shell Protocol Definitions
 *
 * Defines the protocol for communication between shell servers and clients
 * @module
 */

import * as rt from 'runtypes';

/**
 * Authentication types supported by the shell protocol
 */
export enum AuthType {
	BASIC = 'basic',
	TOKEN = 'token',
	NONE = 'none',
}

/**
 * Authentication options for the shell server
 */
export interface AuthOptions {
	type: AuthType;
	users?: { username: string; passwordHash: string }[];
	tokenValidator?: (token: string) => Promise<boolean>;
}

/**
 * Authentication credentials for the shell client
 */
export interface AuthCredentials {
	username?: string;
	password?: string;
	token?: string;
}

/**
 * Base message interface for all protocol messages
 */
export interface BaseMessage {
	id: string;
	type: MessageType;
	timestamp: number;
}

/**
 * Message types supported by the shell protocol
 */
export enum MessageType {
	AUTH_REQUEST = 'auth_request',
	AUTH_RESPONSE = 'auth_response',
	COMMAND_REQUEST = 'command_request', // Note: This might be deprecated/removed later
	COMMAND_RESPONSE = 'command_response',// Note: This might be deprecated/removed later
	OUTPUT = 'output',
	ERROR = 'error',
	PING = 'ping',
	PONG = 'pong',
	DISCONNECT = 'disconnect',
	INPUT = 'input',
}

/**
 * Authentication request message
 */
export interface AuthRequestMessage extends BaseMessage {
	type: MessageType.AUTH_REQUEST;
	payload: {
		authType: AuthType;
		username?: string;
		password?: string;
		token?: string;
	};
}

/**
 * Authentication response message
 */
export interface AuthResponseMessage extends BaseMessage {
	type: MessageType.AUTH_RESPONSE;
	payload: {
		success: boolean;
		error?: string;
		sessionId?: string;
	};
}

/**
 * Input message for sending data to the shell
 */
export interface InputMessage extends BaseMessage {
	type: MessageType.INPUT;
	payload: {
		data: string; // The input data (e.g., characters typed)
		sessionId: string;
	};
}


/**
 * Command request message (Potentially deprecated for interactive shell)
 */
export interface CommandRequestMessage extends BaseMessage {
	type: MessageType.COMMAND_REQUEST;
	payload: {
		command: string;
		args?: unknown[];
		sessionId: string;
	};
}

/**
 * Command response message (Potentially deprecated for interactive shell)
 */
export interface CommandResponseMessage extends BaseMessage {
	type: MessageType.COMMAND_RESPONSE;
	payload: {
		success: boolean;
		output?: string; // Bundled output - less suitable for streaming
		error?: string;
		commandId: string; // ID of the original CommandRequest
	};
}

/**
 * Output message for streaming shell output
 */
export interface OutputMessage extends BaseMessage {
	type: MessageType.OUTPUT;
	payload: {
		content: string; // Chunk of output data
		commandId: string; // Identifier (can be generic like 'shell_output')
		final: boolean; // Indicates if this is the final output chunk for a logical block (less relevant for continuous shell)
	};
}

/**
 * Error message
 */
export interface ErrorMessage extends BaseMessage {
	type: MessageType.ERROR;
	payload: {
		message: string;
		code: string; // e.g., 'AUTH_REQUIRED', 'INVALID_MESSAGE'
	};
}

/**
 * Ping message for keepalive
 */
export interface PingMessage extends BaseMessage {
	type: MessageType.PING;
	// No payload
}

/**
 * Pong message in response to ping
 */
export interface PongMessage extends BaseMessage {
	type: MessageType.PONG;
	payload: {
		uptime: number; // Server uptime example
	};
}

/**
 * Disconnect message
 */
export interface DisconnectMessage extends BaseMessage {
	type: MessageType.DISCONNECT;
	payload: {
		reason: string;
	};
}

/**
 * Union type of all protocol messages (TypeScript interfaces)
 */
export type ProtocolMessage =
	| AuthRequestMessage
	| AuthResponseMessage
	| CommandRequestMessage
	| CommandResponseMessage
	| OutputMessage
	| ErrorMessage
	| PingMessage
	| PongMessage
	| DisconnectMessage
	| InputMessage;

/**
 * Connection interface for tracking active connections on the server
 */
export interface Connection {
	id: string;
	username?: string;
	connected: boolean;
	connectedAt: number;
	lastActivity: number;
	send: (message: ProtocolMessage) => Promise<void>;
	disconnect: (reason: string) => Promise<void>;
}

/**
 * Events emitted by the server
 */
export enum ServerEvent {
	CONNECT = 'connect',
	DISCONNECT = 'disconnect',
	COMMAND = 'command', // Emitted when a command is processed (might be less relevant now)
	ERROR = 'error',
}

/**
 * Events emitted by the client
 */
export enum ClientEvent {
	CONNECT = 'connect', // Includes authentication status and sessionId
	DISCONNECT = 'disconnect',
	OUTPUT = 'output', // Emits content from OUTPUT messages
	ERROR = 'error', // Emits server-sent errors or connection errors
}


/**
 * Runtypes for validating protocol messages at runtime
 */

// Base message validator
export const BaseMessageRT = rt.Record({
	id: rt.String,
	type: rt.String, // Keep as string initially, union below enforces specific types
	timestamp: rt.Number,
});

// Auth request validator
export const AuthRequestRT = BaseMessageRT.And(rt.Record({
	type: rt.Literal(MessageType.AUTH_REQUEST),
	payload: rt.Record({
		authType: rt.Union(
			rt.Literal(AuthType.BASIC),
			rt.Literal(AuthType.TOKEN),
			rt.Literal(AuthType.NONE),
		),
		username: rt.String.optional(),
		password: rt.String.optional(),
		token: rt.String.optional(),
	}),
}));

// Auth response validator
export const AuthResponseRT = BaseMessageRT.And(rt.Record({
	type: rt.Literal(MessageType.AUTH_RESPONSE),
	payload: rt.Record({
		success: rt.Boolean,
		error: rt.String.optional(),
		sessionId: rt.String.optional(),
	}),
}));

// Input message validator
export const InputMessageRT = BaseMessageRT.And(rt.Record({
	type: rt.Literal(MessageType.INPUT),
	payload: rt.Record({
		data: rt.String,
		sessionId: rt.String,
	}),
}));


// Command request validator (Potentially deprecated)
export const CommandRequestRT = BaseMessageRT.And(rt.Record({
	type: rt.Literal(MessageType.COMMAND_REQUEST),
	payload: rt.Record({
		command: rt.String,
		args: rt.Array(rt.Unknown).optional(),
		sessionId: rt.String,
	}),
}));

// Command response validator (Potentially deprecated)
export const CommandResponseRT = BaseMessageRT.And(rt.Record({
	type: rt.Literal(MessageType.COMMAND_RESPONSE),
	payload: rt.Record({
		success: rt.Boolean,
		output: rt.String.optional(),
		error: rt.String.optional(),
		commandId: rt.String,
	}),
}));

// Output message validator
export const OutputMessageRT = BaseMessageRT.And(rt.Record({
	type: rt.Literal(MessageType.OUTPUT),
	payload: rt.Record({
		content: rt.String,
		commandId: rt.String,
		final: rt.Boolean,
	}),
}));

// Error message validator
export const ErrorMessageRT = BaseMessageRT.And(rt.Record({
	type: rt.Literal(MessageType.ERROR),
	payload: rt.Record({
		message: rt.String,
		code: rt.String,
	}),
}));

// Ping message validator (no payload)
export const PingMessageRT = BaseMessageRT.And(rt.Record({
	type: rt.Literal(MessageType.PING),
	// No 'payload' field expected
}));

// Pong message validator
export const PongMessageRT = BaseMessageRT.And(rt.Record({
	type: rt.Literal(MessageType.PONG),
	payload: rt.Record({
		uptime: rt.Number,
	}),
}));

// Disconnect message validator
export const DisconnectMessageRT = BaseMessageRT.And(rt.Record({
	type: rt.Literal(MessageType.DISCONNECT),
	payload: rt.Record({
		reason: rt.String,
	}),
}));


// Union of all specific message Runtype validators
export const ProtocolMessageRT = rt.Union(
	AuthRequestRT,
	AuthResponseRT,
	CommandRequestRT,    // Keep for now, maybe remove later
	CommandResponseRT,   // Keep for now, maybe remove later
	OutputMessageRT,
	ErrorMessageRT,
	InputMessageRT,
	PingMessageRT,       // Use specific validator
	PongMessageRT,       // Use specific validator
	DisconnectMessageRT, // Use specific validator
);
