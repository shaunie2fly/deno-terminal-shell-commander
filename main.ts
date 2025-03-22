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
  action: () => console.log(colors.formatSuccess("Hello from the shell!")),
});

commandRegistry.register("time", {
  description: "Display current time",
  action: () => console.log(colors.formatInfo(`Current time: ${new Date().toLocaleTimeString()}`)),
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
        console.log(colors.formatWarning("No files found."));
        return;
      }
      
      console.log(colors.formatHelpTitle("Files in current directory:"));
      entries.forEach(entry => console.log(`  ${colors.formatInfo(entry)}`));
    } catch (error) {
      console.log(colors.formatError("Error", `Error listing files: ${error.message}`));
    }
  }
});

fileSubcommands.set("info", {
  description: "Show file information",
  action: () => console.log(colors.formatExecuting("File info command (placeholder)")),
});

fileSubcommands.set("search", {
  description: "Search for files",
  action: () => console.log(colors.formatExecuting("File search command (placeholder)")),
});

// Register the file command with its subcommands
commandRegistry.register("file", {
  description: "File operations",
  action: () => {
    console.log(colors.formatHelpTitle("File command usage:"));
    console.log(`  ${colors.formatHelpCommand("file list")}    - ${colors.formatHelpDescription("List files in the current directory")}`);
    console.log(`  ${colors.formatHelpCommand("file info")}    - ${colors.formatHelpDescription("Show file information")}`);
    console.log(`  ${colors.formatHelpCommand("file search")}  - ${colors.formatHelpDescription("Search for files")}`);
  },
  subcommands: fileSubcommands
});

// Service command example with subcommands
const serviceSubcommands = new Map<string, CommandOptions>();

serviceSubcommands.set("start", {
  description: "Start a service",
  action: () => console.log(colors.formatSuccess("Service started (placeholder)")),
});

serviceSubcommands.set("stop", {
  description: "Stop a service",
  action: () => console.log(colors.formatWarning("Service stopped (placeholder)")),
});

serviceSubcommands.set("restart", {
  description: "Restart a service",
  action: () => console.log(colors.formatExecuting("Service restarting...") + "\n" + colors.formatSuccess("Service restarted (placeholder)")),
});

serviceSubcommands.set("status", {
  description: "Show service status",
  action: () => console.log(colors.formatInfo("Service status: active (placeholder)")),
});

// Register the service command with its subcommands
commandRegistry.register("service", {
  description: "Service management",
  action: () => {
    console.log(colors.formatHelpTitle("Service command usage:"));
    console.log(`  ${colors.formatHelpCommand("service start")}    - ${colors.formatHelpDescription("Start a service")}`);
    console.log(`  ${colors.formatHelpCommand("service stop")}     - ${colors.formatHelpDescription("Stop a service")}`);
    console.log(`  ${colors.formatHelpCommand("service restart")}  - ${colors.formatHelpDescription("Restart a service")}`);
    console.log(`  ${colors.formatHelpCommand("service status")}   - ${colors.formatHelpDescription("Show service status")}`);
  },
  subcommands: serviceSubcommands
});

// Add a color demo command to showcase the different color options
commandRegistry.register("colors", {
  description: "Display color demo",
  action: () => {
    console.log(colors.formatHelpTitle("Color Demo"));
    console.log(colors.border(80, "Command Output Colors"));
    console.log(colors.formatSuccess("Success message - Used for successful operations"));
    console.log(colors.formatInfo("Info message - Used for general information"));
    console.log(colors.formatWarning("Warning message - Used for warnings"));
    console.log(colors.formatExecuting("Executing message - Used for in-progress operations"));
    
    console.log(colors.border(80, "Error Formatting"));
    console.log(colors.formatError("Error Title", "Error message details", "Optional hint to resolve the error"));
    
    console.log(colors.border(80, "Help Text Formatting"));
    console.log(colors.formatHelpTitle("Help Section Title"));
    console.log(`${colors.formatHelpCommand("command")}    ${colors.formatHelpDescription("Command description")}`);
    console.log(`${colors.formatHelpExample("Example: command arg --option=value")}`);
    
    console.log(colors.border(80, "Utility Formatting"));
    console.log(`${colors.highlight("Highlighted text")} - ${colors.dim("Dimmed text")}`);
    console.log(colors.header("Section Header"));
  },
});

// Help command to display all commands
commandRegistry.register("help", {
  description: "Display available commands",
  action: () => {
    console.log("\n" + colors.formatHelpTitle("Available commands:"));
    console.log(colors.border(80));
    
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
    
    // Display basic commands
    console.log("\n" + colors.header("Basic commands:"));
    for (const { name, cmd } of basicCommands) {
      console.log(`  ${colors.formatHelpCommand(name.padEnd(12))} ${colors.formatHelpDescription(cmd.description)}`);
    }
    
    // Display commands with subcommands
    console.log("\n" + colors.header("Commands with subcommands:"));
    for (const { name, cmd } of commandsWithSubcommands) {
      console.log(`  ${colors.formatHelpCommand(name.padEnd(12))} ${colors.formatHelpDescription(cmd.description)}`);
      
      // Show available subcommands
      if (cmd.subcommands) {
        for (const [subName, subCmd] of cmd.subcommands) {
          console.log(`    ${colors.formatHelpCommand(name)} ${colors.formatHelpCommand(subName.padEnd(10))} ${colors.formatHelpDescription(subCmd.description)}`);
        }
      }
    }
    
    console.log("\n" + colors.header("Features:"));
    console.log(`  ${colors.formatInfo("- Use up/down arrows for command history")}`);
    console.log(`  ${colors.formatInfo("- Press Tab for command completion")}`);
    console.log(`  ${colors.formatInfo("- Use '/exit' to quit")}`);
    console.log(`  ${colors.formatInfo("- Try the 'colors' command to see color formatting options")}`);
  },
});

// Start the shell
await shell.start();
