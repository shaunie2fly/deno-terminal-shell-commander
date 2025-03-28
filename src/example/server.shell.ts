import { ShellServer, AuthType } from '../../mod.ts';
import type { Command, CommandContext, ParsedArguments } from '../../mod.ts';

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
	parameters: [ // Define the accepted parameter
		{ name: 'string', alias: 's', description: 'The text to echo', type: 'string', required: true }
	],
	action: (context: CommandContext, parsedArgs: ParsedArguments) => { // Use ParsedArguments
		const textToEcho = parsedArgs.options['string']; // Get value from parsed options
		if (typeof textToEcho !== 'string' || textToEcho.length === 0) {
			// Error handled by parser's required check, but good to be defensive
			context.write(`Error: Missing or invalid --string option.\r\n`, { format: 'error' });
			return;
		}
		context.write(`${textToEcho}\r\n`);
	},
};
// Removed extraneous };

const echoReverseCommand: Command = {
    name: 'reverse',
    description: 'Echoes the provided text in reverse.',
 parameters: [ // Define the accepted parameter
  { name: 'string', alias: 's', description: 'The text to reverse', type: 'string', required: true }
 ],
 action: (context: CommandContext, parsedArgs: ParsedArguments) => { // Use ParsedArguments
  const textToReverse = parsedArgs.options['string']; // Get value from parsed options
  if (typeof textToReverse !== 'string' || textToReverse.length === 0) {
   // Error handled by parser's required check, but good to be defensive
   context.write(`Error: Missing or invalid --string option.\r\n`, { format: 'error' });
   return;
  }
  const output = textToReverse.split('').reverse().join('');
  context.write(`${output}\r\n`);
 },
};

const echoCommand: Command = {
    name: 'echo',
    description: 'Echoes text normally or reversed.',
    
    // Optional: Default action if just 'echo' is typed
    // Default action updated to reflect new parameter usage
    action: (context: CommandContext, parsedArgs: ParsedArguments) => {
  // Check if help wasn't already handled (e.g., if called directly without args/help flag)
  if (!parsedArgs.helpRequested) {
         context.write('Usage: echo <normal|reverse> --string=<text>\r\n');
  }
    },
    subcommands: new Map<string, Command>([
        [echoNormalCommand.name, echoNormalCommand],
        [echoReverseCommand.name, echoReverseCommand],
       ]),
      
       // Add argument suggestions for the first argument (which are the subcommands)
       getArgumentSuggestions: (_context, currentArgs, partialArg) => {
        const possibleArgs = ['normal', 'reverse'];
        if (currentArgs.length === 0) {
        	// Only suggest for the first argument position
        	return possibleArgs.filter(arg => arg.startsWith(partialArg));
        }
        return []; // No suggestions for subsequent arguments
       },
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
