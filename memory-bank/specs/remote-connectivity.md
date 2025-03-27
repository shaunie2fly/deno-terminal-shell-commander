# Remote Shell Connectivity

## 1. Architecture Overview

The remote shell connectivity module provides network capabilities to the terminal shell, allowing it to be accessed remotely through multiple protocols. For the initial implementation, we will focus on the TCP Socket Adapter as the primary protocol.

```
@terminal-shell/remote/
├── server/                  # Server-side implementation
│   ├── ShellServer.ts       # Main server implementation
│   ├── Connection.ts        # Connection management
│   ├── adapters/            # Protocol adapters
│   │   ├── TcpAdapter.ts    # TCP socket adapter (PHASE 1 - INITIAL IMPLEMENTATION)
│   │   ├── UnixAdapter.ts   # Unix domain socket adapter (FUTURE)
│   │   └── WsAdapter.ts     # WebSocket adapter (FUTURE)
│   └── auth/                # Authentication providers
│       ├── BasicAuth.ts     # Username/password auth
│       ├── TokenAuth.ts     # Token-based auth
│       └── types.ts         # Auth provider interfaces
├── client/                  # Client-side implementation
│   ├── ShellClient.ts       # Main client implementation
│   ├── adapters/            # Client protocol adapters
│   │   ├── TcpAdapter.ts    # TCP client adapter
│   │   ├── UnixAdapter.ts   # Unix domain socket client
│   │   └── WsAdapter.ts     # WebSocket client
│   └── auth/                # Client auth handlers
│       ├── BasicAuth.ts     # Username/password handler
│       ├── TokenAuth.ts     # Token-based auth handler
│       └── types.ts         # Auth handler interfaces
└── protocol/                # Shared protocol definitions
    ├── messages.ts          # Message type definitions
    ├── serialization.ts     # Message serialization
    ├── errors.ts            # Protocol error types
    └── version.ts           # Protocol versioning
```

## 2. Protocol Specification

### 2.1 Message Format

All messages are JSON objects with the following base structure:

```typescript
interface BaseMessage {
  id: string;              // Unique message ID
  type: MessageType;       // Type of message
  version: string;         // Protocol version
  timestamp: number;       // Unix timestamp (ms)
}

enum MessageType {
  COMMAND = 'command',     // Command execution request
  RESPONSE = 'response',   // Command execution response
  EVENT = 'event',         // Shell event
  STREAM = 'stream',       // Stream data (input/output)
  AUTH = 'auth',           // Authentication message
  ERROR = 'error',         // Error message
  PING = 'ping',           // Heartbeat ping
  PONG = 'pong'            // Heartbeat pong
}
```

### 2.2 Command Messages

```typescript
interface CommandMessage extends BaseMessage {
  type: MessageType.COMMAND;
  payload: {
    command: string;       // Full command string
    args?: unknown[];      // Parsed arguments (optional)
    metadata?: Record<string, unknown>; // Additional metadata
  };
}
```

### 2.3 Response Messages

```typescript
interface ResponseMessage extends BaseMessage {
  type: MessageType.RESPONSE;
  correlationId: string;   // ID of the command message
  payload: {
    status: 'success' | 'error';
    result?: unknown;      // Command result data
    error?: {              // Error information (if status is 'error')
      code: string;
      message: string;
      stack?: string;
    };
  };
}
```

### 2.4 Event Messages

```typescript
interface EventMessage extends BaseMessage {
  type: MessageType.EVENT;
  payload: {
    name: string;          // Event name
    data?: unknown;        // Event data
  };
}
```

### 2.5 Stream Messages

```typescript
interface StreamMessage extends BaseMessage {
  type: MessageType.STREAM;
  streamType: 'stdout' | 'stderr' | 'stdin';
  payload: {
    data: string;          // Stream content
    encoding: 'utf8' | 'base64'; // Data encoding
    end?: boolean;         // End of stream marker
  };
}
```

### 2.6 Authentication Messages

```typescript
interface AuthMessage extends BaseMessage {
  type: MessageType.AUTH;
  authType: 'basic' | 'token' | 'custom';
  payload: Record<string, unknown>; // Auth-specific data
}

// Example for basic auth
interface BasicAuthPayload {
  username: string;
  password: string;
}

// Example for token auth
interface TokenAuthPayload {
  token: string;
}
```

### 2.7 Error Messages

```typescript
interface ErrorMessage extends BaseMessage {
  type: MessageType.ERROR;
  correlationId?: string;  // Optional correlation ID
  payload: {
    code: string;          // Error code
    message: string;       // Human-readable message
    details?: unknown;     // Additional error details
  };
}
```

### 2.8 Heartbeat Messages

```typescript
interface PingMessage extends BaseMessage {
  type: MessageType.PING;
}

interface PongMessage extends BaseMessage {
  type: MessageType.PONG;
  correlationId: string;   // ID of the ping message
}
```

## 3. Connection Lifecycle

### 3.1 Connection Establishment

1. Client connects to server via TCP, Unix socket, or WebSocket
2. Server accepts connection and assigns a connection ID
3. Server sends a welcome message with protocol version
4. Client sends authentication message
5. Server validates credentials and responds with auth result
6. If authentication succeeds, connection enters ready state

### 3.2 Command Execution

1. Client sends command message with unique ID
2. Server processes command and generates response
3. During command execution, server may send stream messages
4. Upon completion, server sends response message with correlation ID

### 3.3 Event Subscription

1. Client can send subscription request for specific events
2. Server registers client for those events
3. When events occur, server sends event messages to subscribed clients

### 3.4 Connection Maintenance

1. Either side may send ping messages to verify connection
2. Receiving side must respond with corresponding pong message
3. Connections with no activity for configurable timeout are closed
4. Clients may reauthorize to refresh session tokens

### 3.5 Connection Termination

1. Either side can initiate connection close
2. Server cleans up resources associated with connection
3. Server emits connection closed event

## 4. Security Model

### 4.1 Authentication Providers

The server supports pluggable authentication providers:

1. **BasicAuthProvider**: Username and password validation
2. **TokenAuthProvider**: JWT or opaque token validation
3. **CustomAuthProvider**: Interface for custom authentication logic

### 4.2 Authorization

1. Command-level authorization through access control lists
2. Permission levels (read, execute, admin)
3. Resource-based permission model

### 4.3 Transport Security

1. TLS encryption for TCP and WebSocket connections
2. Certificate validation for clients and servers
3. Modern cipher suites and protocols (TLS 1.3+)

### 4.4 Protection Mechanisms

1. Rate limiting for connection attempts and commands
2. Automatic timeout for idle connections
3. Command execution quotas
4. Audit logging of all commands and connections

## 5. Implementation Details

### 5.1 Server Implementation

```typescript
export interface ShellServerOptions {
  shell: Shell;                      // Shell instance to expose
  adapters?: ProtocolAdapter[];      // Protocol adapters (defaults provided)
  auth?: AuthProvider | AuthProvider[]; // Auth providers
  security?: SecurityOptions;        // Security settings
}

export class ShellServer {
  constructor(options: ShellServerOptions);
  
  // Core methods
  async start(): Promise<void>;      // Start all configured adapters
  async stop(): Promise<void>;       // Stop all adapters and disconnect clients
  
  // Connection management
  getConnections(): Connection[];    // Get all active connections
  getConnection(id: string): Connection | null; // Get connection by ID
  disconnectAll(): Promise<void>;    // Disconnect all clients
  disconnect(id: string): Promise<void>; // Disconnect specific client
  
  // Event handlers
  on(event: ServerEvent, handler: EventHandler): void;
  off(event: ServerEvent, handler: EventHandler): void;
  
  // Statistics and monitoring
  getStats(): ServerStats;           // Get server statistics
}
```

### 5.2 Client Implementation

```typescript
export interface ShellClientOptions {
  adapter: ProtocolAdapterType;      // Protocol adapter type
  adapterOptions: Record<string, unknown>; // Adapter-specific options
  auth?: AuthHandler;                // Authentication handler
  security?: ClientSecurityOptions;  // Security settings
}

export class ShellClient {
  constructor(options: ShellClientOptions);
  
  // Connection management
  async connect(): Promise<void>;    // Connect to server
  async disconnect(): Promise<void>; // Disconnect from server
  isConnected(): boolean;            // Check connection status
  
  // Shell interaction
  async executeCommand(command: string): Promise<CommandResult>;
  async executeRaw(commandObj: CommandObject): Promise<CommandResult>;
  
  // Stream management
  getOutputStream(): ReadableStream<string>; // Get shell output
  getInputStream(): WritableStream<string>;  // Get shell input
  
  // Event handlers
  on(event: ClientEvent, handler: EventHandler): void;
  off(event: ClientEvent, handler: EventHandler): void;
  
  // Advanced features
  subscribeToEvents(events: string[]): Promise<void>;
  unsubscribeFromEvents(events: string[]): Promise<void>;
}
```

### 5.3 Protocol Adapters

```typescript
export interface ProtocolAdapter {
  type: ProtocolAdapterType;         // Adapter type identifier
  start(): Promise<void>;            // Start listening for connections
  stop(): Promise<void>;             // Stop accepting connections
  
  // Events
  on(event: AdapterEvent, handler: EventHandler): void;
  off(event: AdapterEvent, handler: EventHandler): void;
  
  // Statistics
  getStats(): AdapterStats;          // Get adapter statistics
}

export enum ProtocolAdapterType {
  TCP = 'tcp',                       // TCP socket
  UNIX = 'unix',                     // Unix domain socket
  WS = 'ws'                          // WebSocket
}
```

### 5.4 Authentication Handlers

```typescript
export interface AuthProvider {
  type: AuthType;                    // Authentication type
  authenticate(credentials: unknown): Promise<AuthResult>;
  validateSession(sessionData: unknown): Promise<boolean>;
  refreshSession(sessionData: unknown): Promise<AuthResult>;
}

export interface AuthHandler {
  type: AuthType;                    // Authentication type
  getCredentials(): Promise<unknown>; // Get credentials for auth
  handleAuthChallenge(challenge: unknown): Promise<unknown>; // Handle auth challenge
}

export enum AuthType {
  BASIC = 'basic',                   // Username/password
  TOKEN = 'token',                   // Token-based
  CUSTOM = 'custom'                  // Custom auth
}
```

## 6. Error Handling

### 6.1 Protocol Errors

```typescript
export enum ProtocolErrorCode {
  INVALID_MESSAGE = 'protocol.invalid_message',
  UNSUPPORTED_VERSION = 'protocol.unsupported_version',
  MESSAGE_TOO_LARGE = 'protocol.message_too_large',
  RATE_LIMIT_EXCEEDED = 'protocol.rate_limit_exceeded'
}
```

### 6.2 Authentication Errors

```typescript
export enum AuthErrorCode {
  INVALID_CREDENTIALS = 'auth.invalid_credentials',
  EXPIRED_SESSION = 'auth.expired_session',
  INSUFFICIENT_PERMISSIONS = 'auth.insufficient_permissions',
  AUTHENTICATION_REQUIRED = 'auth.authentication_required'
}
```

### 6.3 Command Errors

```typescript
export enum CommandErrorCode {
  COMMAND_NOT_FOUND = 'command.not_found',
  INVALID_ARGUMENTS = 'command.invalid_arguments',
  EXECUTION_FAILED = 'command.execution_failed',
  TIMEOUT = 'command.timeout'
}
```

## 7. Event System

### 7.1 Server Events

```typescript
export enum ServerEvent {
  START = 'server:start',
  STOP = 'server:stop',
  CONNECTION = 'connection:new',
  DISCONNECTION = 'connection:close',
  AUTHENTICATION = 'auth:attempt',
  AUTHENTICATION_SUCCESS = 'auth:success',
  AUTHENTICATION_FAILURE = 'auth:failure',
  COMMAND = 'command:receive',
  COMMAND_COMPLETE = 'command:complete',
  COMMAND_ERROR = 'command:error',
  ERROR = 'server:error'
}
```

### 7.2 Client Events

```typescript
export enum ClientEvent {
  CONNECT = 'client:connect',
  DISCONNECT = 'client:disconnect',
  AUTHENTICATION = 'auth:start',
  AUTHENTICATION_SUCCESS = 'auth:success',
  AUTHENTICATION_FAILURE = 'auth:failure',
  COMMAND_SEND = 'command:send',
  COMMAND_RESPONSE = 'command:response',
  COMMAND_ERROR = 'command:error',
  OUTPUT = 'stream:output',
  ERROR = 'client:error'
}
```

## 8. Security Best Practices

### 8.1 TLS Configuration

```typescript
export interface TlsOptions {
  cert: string;                      // Server certificate
  key: string;                       // Private key
  ca?: string;                       // CA certificate for client validation
  requestCert?: boolean;             // Request client certificate
  rejectUnauthorized?: boolean;      // Reject unauthorized connections
  ciphers?: string;                  // Allowed cipher suites
  minVersion?: string;               // Minimum TLS version
}
```

### 8.2 Rate Limiting

```typescript
export interface RateLimitOptions {
  maxConnections: number;            // Maximum concurrent connections
  maxConnectionsPerIp: number;       // Maximum connections per IP
  maxCommandsPerMinute: number;      // Maximum commands per minute
  maxAuthAttemptsPerIp: number;      // Maximum auth attempts per IP
  ipBlockDuration: number;           // Duration of IP blocks (ms)
}
```

### 8.3 Auditing

```typescript
export interface AuditOptions {
  enabled: boolean;                  // Enable audit logging
  events: AuditEvent[];              // Events to audit
  logPath?: string;                  // Path for audit logs
  rotation?: {                       // Log rotation settings
    maxSize: string;                 // Maximum log size
    maxFiles: number;                // Maximum number of files
  };
}

export enum AuditEvent {
  CONNECTION = 'connection',
  AUTHENTICATION = 'authentication',
  COMMAND = 'command',
  DISCONNECTION = 'disconnection',
  ERROR = 'error'
}
```

## 9. Deployment Models

### 9.1 Single Process

Shell and server in the same process with direct access.

### 9.2 Multi-Process / IPC

Shell in one process, server in another, communicating via IPC.

### 9.3 Distributed

Shell instances and servers running on different machines, connected via network.

## 10. Examples

### 10.1 Basic Server

```typescript
import { Shell } from "@terminal-shell/shell/Shell.ts";
import { ShellServer } from "@terminal-shell/remote/server/ShellServer.ts";
import { TcpAdapter } from "@terminal-shell/remote/server/adapters/TcpAdapter.ts";
import { BasicAuthProvider } from "@terminal-shell/remote/server/auth/BasicAuth.ts";

// Create shell instance
const shell = new Shell({
  name: "RemoteShell",
  prompt: "remote> "
});

// Configure server
const server = new ShellServer({
  shell,
  adapters: [
    new TcpAdapter({
      host: "0.0.0.0",
      port: 8888
    })
  ],
  auth: new BasicAuthProvider({
    users: [
      { username: "admin", password: "securePassword" }
    ]
  }),
  security: {
    tls: {
      cert: await Deno.readTextFile("./cert.pem"),
      key: await Deno.readTextFile("./key.pem")
    },
    rateLimit: {
      maxConnections: 10,
      maxConnectionsPerIp: 3,
      maxCommandsPerMinute: 60
    }
  }
});

// Start server
await server.start();
console.log("Shell server running on port 8888");

// Handle server events
server.on(ServerEvent.CONNECTION, (conn) => {
  console.log(`New connection: ${conn.id} from ${conn.remoteAddress}`);
});

server.on(ServerEvent.COMMAND, (cmd, conn) => {
  console.log(`Command received from ${conn.id}: ${cmd.payload.command}`);
});

// Later, to stop the server
// await server.stop();
```

### 10.2 Basic Client

```typescript
import { ShellClient } from "@terminal-shell/remote/client/ShellClient.ts";
import { TcpAdapter } from "@terminal-shell/remote/client/adapters/TcpAdapter.ts";
import { BasicAuthHandler } from "@terminal-shell/remote/client/auth/BasicAuth.ts";
import { ClientEvent } from "@terminal-shell/remote/protocol/messages.ts";

// Configure client
const client = new ShellClient({
  adapter: ProtocolAdapterType.TCP,
  adapterOptions: {
    host: "localhost",
    port: 8888
  },
  auth: new BasicAuthHandler({
    username: "admin",
    password: "securePassword"
  }),
  security: {
    tls: {
      rejectUnauthorized: true,
      ca: await Deno.readTextFile("./ca.pem") 
    }
  }
});

// Connect to server
await client.connect();
console.log("Connected to shell server");

// Get output stream
const outputStream = client.getOutputStream();
(async () => {
  for await (const chunk of outputStream) {
    console.log(chunk); // Display output
  }
})();

// Execute command
const result = await client.executeCommand("help");
console.log("Command result:", result);

// Handle events
client.on(ClientEvent.DISCONNECT, () => {
  console.log("Disconnected from server");
});

// Disconnect when done
// await client.disconnect();
```

## 11. Future Enhancements

### 11.1 Multiplexing

Support for multiple shells over a single connection.

### 11.2 Compression

Message compression for high-latency or bandwidth-constrained environments.

### 11.3 Protocol Extensions

Extensible protocol negotiation for custom features.

### 11.4 Web Clients

Browser-based clients with WebSocket support.

### 11.5 Federation

Connect multiple shell servers in a federated network.

## 12. Implementation Phases

### 12.1 Phase 1: TCP Socket Adapter (Current Focus)

The TCP socket adapter will be the first protocol adapter implementation, providing a solid foundation for remote shell connectivity. This adapter enables network-based communication between shell clients and servers over standard TCP/IP sockets.

#### 12.1.1 TCP Adapter Features

- Network-accessible shell instances via TCP/IP
- Binary protocol with JSON message encoding
- Support for secure TLS connections
- Basic authentication support
- Command execution and streaming output
- Event notification system

#### 12.1.2 TCP Adapter Architecture

```typescript
/**
 * TCP Adapter for Shell Server
 */
export interface TcpAdapterOptions {
  host: string;                // Host to bind to (default: "127.0.0.1")
  port: number;                // Port to listen on (default: 8888)
  backlog?: number;            // Connection backlog size (default: 10)
  tls?: TlsOptions;            // TLS configuration for secure connections
  maxConnections?: number;     // Maximum concurrent connections (default: 100)
  connectionTimeout?: number;  // Connection idle timeout in ms (default: 60000)
  messageMaxSize?: number;     // Maximum message size in bytes (default: 1MB)
  pingInterval?: number;       // Interval between ping messages in ms (default: 30000)
}

export class TcpAdapter implements ProtocolAdapter {
  type = ProtocolAdapterType.TCP;
  
  constructor(options: TcpAdapterOptions);
  
  // Core methods
  async start(): Promise<void>;   // Start listening for connections
  async stop(): Promise<void>;    // Stop accepting connections
  
  // Event handlers
  on(event: AdapterEvent, handler: EventHandler): void;
  off(event: AdapterEvent, handler: EventHandler): void;
  
  // Connection management
  getConnections(): TcpConnection[];
  disconnectAll(): Promise<void>;
  disconnect(connectionId: string): Promise<void>;
  
  // Statistics and monitoring
  getStats(): TcpAdapterStats;
}
```

#### 12.1.3 TCP Connection Management

```typescript
/**
 * TCP Connection class representing a client connection
 */
export class TcpConnection {
  id: string;                // Unique connection ID
  remoteAddress: string;     // Remote client IP address
  remotePort: number;        // Remote client port
  authenticated: boolean;    // Authentication status
  connectedAt: Date;         // Connection timestamp
  lastActivityAt: Date;      // Last activity timestamp
  
  // Core methods
  async send(message: Message): Promise<void>;
  async disconnect(reason?: string): Promise<void>;
  
  // Message handling
  onMessage(handler: MessageHandler): void;
  
  // Event handlers
  on(event: ConnectionEvent, handler: EventHandler): void;
  off(event: ConnectionEvent, handler: EventHandler): void;
}
```

### 12.2 Phase 2: Unix Domain Sockets and WebSockets (Future)

After completing the TCP adapter implementation, we will expand to support:

1. **Unix Domain Sockets**: For high-performance local IPC communication
2. **WebSockets**: For browser-based clients and HTTP-friendly environments

### 12.3 Phase 3: Advanced Features (Future)

Future enhancements will include:

1. **Protocol multiplexing**: Multiple shells per connection
2. **Compression**: For bandwidth-constrained environments
3. **Advanced authentication**: OAuth, JWT, and custom auth providers
4. **Command streaming**: Bidirectional streaming for long-running commands

## 13. TCP Implementation Details

### 13.1 Message Framing

TCP is a stream-based protocol, so we need to implement message framing. Our approach uses a simple length-prefixed format:

```
[4-byte message length][message data]
```

Where:
- Message length is a 32-bit unsigned integer in network byte order (big-endian)
- Message data is UTF-8 encoded JSON

### 13.2 Connection Handling

The TcpAdapter handles connections using the following approach:

1. Create TCP listener on specified host and port
2. Accept incoming connections and create TcpConnection objects
3. For each connection:
   - Initialize message parser
   - Register message handlers
   - Set up connection timeout monitoring
   - Send welcome message with protocol version
   - Wait for authentication message
   - Process messages until connection closes

### 13.3 Error Recovery

The TcpAdapter implements several strategies for handling network errors:

1. **Connection errors**: Automatically clean up resources and emit disconnection events
2. **Partial messages**: Buffer incomplete messages until fully received
3. **Protocol errors**: Send error messages to client and optionally disconnect
4. **Server errors**: Log errors and attempt to continue processing other connections

### 13.4 Security Considerations

The TCP implementation includes these security features:

1. **TLS encryption**: Optional TLS for secure communications
2. **Connection limits**: Per-IP and global connection limits
3. **Resource protection**: Message size limits and timeouts
4. **Authentication**: Required authentication before command execution

## 14. Example TCP Implementation

### 14.1 Basic TCP Server

```typescript
import { Shell } from "@terminal-shell/shell/Shell.ts";
import { ShellServer } from "@terminal-shell/remote/server/ShellServer.ts";
import { TcpAdapter } from "@terminal-shell/remote/server/adapters/TcpAdapter.ts";
import { BasicAuthProvider } from "@terminal-shell/remote/server/auth/BasicAuth.ts";
import { ServerEvent } from "@terminal-shell/remote/protocol/messages.ts";

// Create shell instance
const shell = new Shell({
  name: "RemoteShell",
  prompt: "remote> "
});

// Register some commands
shell.registerCommand({
  name: "status",
  description: "Show server status",
  action: () => {
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    shell.write(`Server uptime: ${uptime}s\nConnections: ${server.getConnections().length}`);
  }
});

// Create the TCP adapter
const tcpAdapter = new TcpAdapter({
  host: "0.0.0.0", // Listen on all interfaces
  port: 8888,
  connectionTimeout: 300000, // 5 minutes
  // Optional TLS configuration
  tls: {
    cert: await Deno.readTextFile("./server.crt"),
    key: await Deno.readTextFile("./server.key")
  }
});

// Configure server with TCP adapter
const server = new ShellServer({
  shell,
  adapters: [tcpAdapter],
  auth: new BasicAuthProvider({
    users: [
      { username: "admin", password: "securePassword" }
    ]
  })
});

// Track server start time
const startTime = Date.now();

// Start server
await server.start();
console.log("Shell server running on TCP port 8888");

// Handle server events
server.on(ServerEvent.CONNECTION, (conn) => {
  console.log(`New connection: ${conn.id} from ${conn.remoteAddress}`);
});

server.on(ServerEvent.COMMAND, (cmd, conn) => {
  console.log(`Command received from ${conn.id}: ${cmd.payload.command}`);
});

// For clean shutdown
Deno.addSignalListener("SIGINT", async () => {
  console.log("Shutting down server...");
  await server.stop();
  Deno.exit(0);
});
```

### 14.2 Basic TCP Client

```typescript
import { ShellClient } from "@terminal-shell/remote/client/ShellClient.ts";
import { ProtocolAdapterType } from "@terminal-shell/remote/protocol/types.ts";
import { BasicAuthHandler } from "@terminal-shell/remote/client/auth/BasicAuth.ts";
import { ClientEvent } from "@terminal-shell/remote/protocol/messages.ts";

// Configure client with TCP adapter
const client = new ShellClient({
  adapter: ProtocolAdapterType.TCP,
  adapterOptions: {
    host: "localhost",
    port: 8888,
    // Optional TLS configuration
    tls: {
      rejectUnauthorized: true, // Verify server certificate
      ca: await Deno.readTextFile("./ca.crt") // CA certificate for validation
    }
  },
  auth: new BasicAuthHandler({
    username: "admin",
    password: "securePassword"
  })
});

// Connect to server
await client.connect();
console.log("Connected to shell server");

// Set up output stream handling
const outputStream = client.getOutputStream();
(async () => {
  for await (const chunk of outputStream) {
    console.log(chunk); // Display output
  }
})();

// Execute command
const result = await client.executeCommand("status");
console.log("Command result:", result);

// Set up input handling from the terminal
const stdin = Deno.stdin.readable;
const reader = stdin.getReader();

// Create transform stream for line processing
const lineTransform = new TransformStream({
  transform(chunk, controller) {
    const line = new TextDecoder().decode(chunk).trim();
    if (line === "exit") {
      controller.terminate();
      return;
    }
    controller.enqueue(line);
  }
});

// Pipe stdin to command execution
(async () => {
  for await (const line of lineTransform.readable) {
    await client.executeCommand(line);
  }
  // When line processing ends, disconnect
  await client.disconnect();
})();

// Handle client events
client.on(ClientEvent.DISCONNECT, () => {
  console.log("Disconnected from server");
  Deno.exit(0);
});
```

## 15. Testing Strategy for TCP Adapter

### 15.1 Unit Tests

- Message serialization/deserialization
- Protocol framing
- Connection timeout handling
- Authentication flow
- Error handling and recovery

### 15.2 Integration Tests

- Server-client communication
- Command execution and response handling
- Stream data processing
- Authentication and authorization
- Concurrent connections and load testing

### 15.3 Security Tests

- TLS configuration validation
- Authentication bypass attempts
- Rate limiting effectiveness
- Message size limit enforcement
- Connection limit enforcement
