import { ShellServer, AuthType, Command, CommandContext } from '../../mod.ts'; // Import Command/Context from main module

// --- Define Base Commands ---
const timeCommand: Command = {
    name: 'time',
    description: 'Displays the current server time dude.',
    action: (context: CommandContext) => { // Use CommandContext type
        const now = new Date();
        // Use context.write provided by the Shell instance
        context.write(`Current server time: ${now.toLocaleTimeString()}\r\n`);
    },
};
// --- Echo Command with Subcommands ---
const echoNormalCommand: Command = {
    name: 'normal',
    description: 'Echoes the provided text.',
    
    // Action receives context and any arguments passed *after* "echo normal"
    action: (context: CommandContext, ...args: string[]) => {
        const output = args.join(' ');
        context.write(`${output}\r\n`);
    },
};

const echoReverseCommand: Command = {
    name: 'reverse',
    description: 'Echoes the provided text in reverse.',
    action: (context: CommandContext, ...args: string[]) => {
        const output = args.join(' ').split('').reverse().join('');
        context.write(`${output}\r\n`);
    },
};

const echoCommand: Command = {
    name: 'echo',
    description: 'Echoes text normally or reversed.',
    
    // Optional: Default action if just 'echo' is typed
    action: (context: CommandContext) => {
        context.write('Usage: echo [normal|reverse] <text...>\r\n');
    },
    subcommands: new Map<string, Command>([
        [echoNormalCommand.name, echoNormalCommand],
        [echoReverseCommand.name, echoReverseCommand],
    ]),
};
// --- End Echo Command ---


// Add all commands to the base list
const baseCommands = [timeCommand, echoCommand]; // Added echoCommand
// --------------------------
// Example usage
const server = new ShellServer({

    defaultPrompt: 'example>',
    maxConnections: 5,
	port: 8080,
	auth: { type: AuthType.BASIC, users: [{ username: 'user', passwordHash: 'd74ff0ee8da3b9806b18c877dbf29bbde50b5bd8e4dad7a3a725000feb82e8f1' },{ username: 'user1', passwordHash: 'd74ff0ee8da3b9806b18c877dbf29bbde50b5bd8e4dad7a3a725000feb82e8f1' }] },
    baseCommands: baseCommands, // Pass the defined commands here
});

await server.start();
