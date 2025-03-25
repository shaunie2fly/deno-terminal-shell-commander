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
	COMMAND_REQUEST = 'command_request',
	COMMAND_RESPONSE = 'command_response',
	OUTPUT = 'output',
	ERROR = 'error',
	PING = 'ping',
	PONG = 'pong',
	DISCONNECT = 'disconnect',
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
 * Command request message
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
 * Command response message
 */
export interface CommandResponseMessage extends BaseMessage {
	type: MessageType.COMMAND_RESPONSE;
	payload: {
		success: boolean;
		output?: string;
		error?: string;
		commandId: string;
	};
}

/**
 * Output message for streaming command output
 */
export interface OutputMessage extends BaseMessage {
	type: MessageType.OUTPUT;
	payload: {
		content: string;
		commandId: string;
		final: boolean;
	};
}

/**
 * Error message
 */
export interface ErrorMessage extends BaseMessage {
	type: MessageType.ERROR;
	payload: {
		message: string;
		code: string;
	};
}

/**
 * Ping message for keepalive
 */
export interface PingMessage extends BaseMessage {
	type: MessageType.PING;
}

/**
 * Pong message in response to ping
 */
export interface PongMessage extends BaseMessage {
	type: MessageType.PONG;
	payload: {
		uptime: number;
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
 * Union type of all protocol messages
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
	| DisconnectMessage;

/**
 * Connection interface for tracking active connections
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
	COMMAND = 'command',
	ERROR = 'error',
}

/**
 * Events emitted by the client
 */
export enum ClientEvent {
	CONNECT = 'connect',
	DISCONNECT = 'disconnect',
	OUTPUT = 'output',
	ERROR = 'error',
}


/**
 * Runtypes for validating protocol messages
 */

// Base message validator
export const BaseMessageRT = rt.Record({
	id: rt.String,
	type: rt.String,
	timestamp: rt.Number,
});

// Auth request validator
export const AuthRequestRT = rt.Record({
	type: rt.Literal(MessageType.AUTH_REQUEST),
	id: rt.String,
	timestamp: rt.Number,
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
});

// Auth response validator
export const AuthResponseRT = rt.Record({
	type: rt.Literal(MessageType.AUTH_RESPONSE),
	id: rt.String,
	timestamp: rt.Number,
	payload: rt.Record({
		success: rt.Boolean,
		error: rt.String.optional(),
		sessionId: rt.String.optional(),
	}),
});

// Command request validator
export const CommandRequestRT = rt.Record({
	type: rt.Literal(MessageType.COMMAND_REQUEST),
	id: rt.String,
	timestamp: rt.Number,
	payload: rt.Record({
		command: rt.String,
		args: rt.Array(rt.Unknown).optional(),
		sessionId: rt.String,
	}),
});

// Command response validator
export const CommandResponseRT = rt.Record({
	type: rt.Literal(MessageType.COMMAND_RESPONSE),
	id: rt.String,
	timestamp: rt.Number,
	payload: rt.Record({
		success: rt.Boolean,
		output: rt.String.optional(),
		error: rt.String.optional(),
		commandId: rt.String,
	}),
});

// Output message validator
export const OutputMessageRT = rt.Record({
	type: rt.Literal(MessageType.OUTPUT),
	id: rt.String,
	timestamp: rt.Number,
	payload: rt.Record({
		content: rt.String,
		commandId: rt.String,
		final: rt.Boolean,
	}),
});

// Error message validator
export const ErrorMessageRT = rt.Record({
	type: rt.Literal(MessageType.ERROR),
	id: rt.String,
	timestamp: rt.Number,
	payload: rt.Record({
		message: rt.String,
		code: rt.String,
	}),
});

// Union of all message validators
export const ProtocolMessageRT = rt.Union(
	AuthRequestRT,
	AuthResponseRT,
	CommandRequestRT,
	CommandResponseRT,
	OutputMessageRT,
	ErrorMessageRT,
	BaseMessageRT.And(rt.Record({
		type: rt.Union(
			rt.Literal(MessageType.PING),
			rt.Literal(MessageType.PONG),
			rt.Literal(MessageType.DISCONNECT),
		),
	})),
);
