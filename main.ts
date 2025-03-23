import { Shell } from "./src/shell.ts";
import { commandRegistry, CommandOptions } from "./src/commands.ts";
import * as colors from "./src/colors.ts";

// Create the shell instance
const shell = new Shell({
  name: "Demo Shell",
  prompt: "demo> ",
});

// Register basic commands
commandRegistry.register("clear", {
  description: "Clear the screen",
  action: () => shell.clearScreen(),
});

commandRegistry.register("hello", {
  description: "Say hello",
  action: () => shell.writeOutput(colors.formatSuccess("Hello from the shell!\n")),
});

commandRegistry.register("time", {
  description: "Display current time",
  action: () => shell.writeOutput(colors.formatInfo(`Current time: ${new Date().toLocaleTimeString()}\n`)),
});

// Register a command with subcommands to demonstrate contextual completion
const fileSubcommands = new Map<string, CommandOptions>();

fileSubcommands.set("list", {
  description: "List files in current directory",
  action: async () => {
    try {
      const entries = [];
      for await (const entry of Deno.readDir(".")) {
        const type = entry.isDirectory ? "directory" : "file";
        entries.push(`${entry.name} (${type})`);
      }
      
      if (entries.length === 0) {
        shell.writeOutput(colors.formatWarning("No files found.\n"));
        return;
      }
      
      const title = colors.formatHelpTitle("Files in current directory:");
      const content = entries.map(entry => `  ${colors.formatInfo(entry)}`).join('\n');
      shell.writeOutput(`${title}\n${content}\n`);
    } catch (error) {
      if (error instanceof Error) {
        shell.writeOutput(colors.formatError("Error", `Error listing files: ${error.message}`) + '\n');
      } else {
        shell.writeOutput(colors.formatError("Error", "An unknown error occurred while listing files") + '\n');
      }
    }
  }
});

fileSubcommands.set("info", {
  description: "Show file information",
  action: () => shell.writeOutput(colors.formatExecuting("File info command (placeholder)\n")),
});

fileSubcommands.set("search", {
  description: "Search for files",
  action: () => shell.writeOutput(colors.formatExecuting("File search command (placeholder)\n")),
});

// Register the file command with its subcommands
commandRegistry.register("file", {
  description: "File operations",
  action: () => {
    const output = [
      colors.formatHelpTitle("File command usage:"),
      `  ${colors.formatHelpCommand("file list")}    - ${colors.formatHelpDescription("List files in the current directory")}`,
      `  ${colors.formatHelpCommand("file info")}    - ${colors.formatHelpDescription("Show file information")}`,
      `  ${colors.formatHelpCommand("file search")}  - ${colors.formatHelpDescription("Search for files")}`
    ].filter(Boolean);
    shell.writeOutput(output.join('\n') + '\n');
  },
  subcommands: fileSubcommands
});

// Service command example with subcommands
const serviceSubcommands = new Map<string, CommandOptions>();

serviceSubcommands.set("start", {
  description: "Start a service",
  action: () => shell.writeOutput(colors.formatSuccess("Service started (placeholder)\n")),
});

serviceSubcommands.set("stop", {
  description: "Stop a service",
  action: () => shell.writeOutput(colors.formatWarning("Service stopped (placeholder)\n")),
});

serviceSubcommands.set("restart", {
  description: "Restart a service",
  action: () => shell.writeOutput(colors.formatExecuting("Service restarting...") + "\n" + colors.formatSuccess("Service restarted (placeholder)\n")),
});

serviceSubcommands.set("status", {
  description: "Show service status",
  action: () => shell.writeOutput(colors.formatInfo("Service status: active (placeholder)\n")),
});

// Register the service command with its subcommands
commandRegistry.register("service", {
  description: "Service management",
  action: () => {
    const output = [
      colors.formatHelpTitle("Service command usage:"),
      `  ${colors.formatHelpCommand("service start")}    - ${colors.formatHelpDescription("Start a service")}`,
      `  ${colors.formatHelpCommand("service stop")}     - ${colors.formatHelpDescription("Stop a service")}`,
      `  ${colors.formatHelpCommand("service restart")}  - ${colors.formatHelpDescription("Restart a service")}`,
      `  ${colors.formatHelpCommand("service status")}   - ${colors.formatHelpDescription("Show service status")}`
    ].filter(Boolean);
    shell.writeOutput(output.join('\n') + '\n');
  },
  subcommands: serviceSubcommands
});

// Add a color demo command to showcase the different color options
commandRegistry.register("colors", {
  description: "Display color demo",
  action: () => {
    const output = [
      colors.formatHelpTitle("Color Demo"),
      colors.border(80, "Command Output Colors"),
      colors.formatSuccess("Success message - Used for successful operations"),
      colors.formatInfo("Info message - Used for general information"),
      colors.formatWarning("Warning message - Used for warnings"),
      colors.formatExecuting("Executing message - Used for in-progress operations"),
      colors.border(80, "Error Formatting"),
      colors.formatError("Error Title", "Error message details", "Optional hint to resolve the error"),
      colors.border(80, "Help Text Formatting"),
      colors.formatHelpTitle("Help Section Title"),
      `${colors.formatHelpCommand("command")}    ${colors.formatHelpDescription("Command description")}`,
      colors.formatHelpExample("Example: command arg --option=value"),
      colors.border(80, "Utility Formatting"),
      `${colors.highlight("Highlighted text")} - ${colors.dim("Dimmed text")}`,
      colors.header("Section Header")
    ].filter(Boolean);
    shell.writeOutput(output.join('\n') + '\n');
  },
});

// Help command to display all commands
commandRegistry.register("help", {
  description: "Display available commands",
  action: () => {
    // Group commands by type
    const basicCommands = [];
    const commandsWithSubcommands = [];
    
    for (const [name, cmd] of commandRegistry.getCommands()) {
      if (cmd.subcommands) {
        commandsWithSubcommands.push({ name, cmd });
      } else {
        basicCommands.push({ name, cmd });
      }
    }

    // Build sections independently
    const header = [
      colors.formatHelpTitle("Available commands:"),
      colors.border(80)
    ].join('\n');

    const basicCommandsSection = [
      colors.header("Basic commands:"),
      ...basicCommands.map(({ name, cmd }) =>
        `  ${colors.formatHelpCommand(name.padEnd(12))} ${colors.formatHelpDescription(cmd.description)}`)
    ].join('\n');

    const subcommandsSection = [
      colors.header("Commands with subcommands:"),
      ...commandsWithSubcommands.flatMap(({ name, cmd }) => [
        `  ${colors.formatHelpCommand(name.padEnd(12))} ${colors.formatHelpDescription(cmd.description)}`,
        ...(cmd.subcommands ? Array.from(cmd.subcommands).map(([subName, subCmd]) => {
          const subCmdStr = `    ${colors.formatHelpCommand(name)} ${colors.formatHelpCommand(subName.padEnd(8))}`;
          return `${subCmdStr} ${colors.formatHelpDescription(subCmd.description)}`;
        }) : [])
      ])
    ].join('\n');

    const featuresSection = [
      colors.header("Features:"),
      `  ${colors.formatInfo("- Use up/down arrows for command history")}`,
      `  ${colors.formatInfo("- Press Tab for command completion")}`,
      `  ${colors.formatInfo("- Use '/exit' to quit")}`,
      `  ${colors.formatInfo("- Try the 'colors' command to see color formatting options")}`
    ] .join('\n') ;

    // Combine all sections with single newlines between them
    shell.writeOutput(`${header}\n${basicCommandsSection}\n${subcommandsSection}\n${featuresSection}\n`);
  },
});

// Start the shell
await shell.start();
