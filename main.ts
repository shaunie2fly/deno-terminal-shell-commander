import { Shell } from "./src/shell.ts";
import { commandRegistry, CommandOptions } from "./src/commands.ts";

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
  action: () => console.log("Hello from the shell!"),
});

commandRegistry.register("time", {
  description: "Display current time",
  action: () => console.log(`Current time: ${new Date().toLocaleTimeString()}`),
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
        console.log("No files found.");
        return;
      }
      
      console.log("Files in current directory:");
      entries.forEach(entry => console.log(`  ${entry}`));
    } catch (error) {
      console.error(`Error listing files: ${error.message}`);
    }
  }
});

fileSubcommands.set("info", {
  description: "Show file information",
  action: () => console.log("File info command (placeholder)"),
});

fileSubcommands.set("search", {
  description: "Search for files",
  action: () => console.log("File search command (placeholder)"),
});

// Register the file command with its subcommands
commandRegistry.register("file", {
  description: "File operations",
  action: () => {
    console.log("File command usage:");
    console.log("  file list    - List files in the current directory");
    console.log("  file info    - Show file information");
    console.log("  file search  - Search for files");
  },
  subcommands: fileSubcommands
});

// Service command example with subcommands
const serviceSubcommands = new Map<string, CommandOptions>();

serviceSubcommands.set("start", {
  description: "Start a service",
  action: () => console.log("Service started (placeholder)"),
});

serviceSubcommands.set("stop", {
  description: "Stop a service",
  action: () => console.log("Service stopped (placeholder)"),
});

serviceSubcommands.set("restart", {
  description: "Restart a service",
  action: () => console.log("Service restarted (placeholder)"),
});

serviceSubcommands.set("status", {
  description: "Show service status",
  action: () => console.log("Service status: active (placeholder)"),
});

// Register the service command with its subcommands
commandRegistry.register("service", {
  description: "Service management",
  action: () => {
    console.log("Service command usage:");
    console.log("  service start    - Start a service");
    console.log("  service stop     - Stop a service");
    console.log("  service restart  - Restart a service");
    console.log("  service status   - Show service status");
  },
  subcommands: serviceSubcommands
});

// Help command to display all commands
commandRegistry.register("help", {
  description: "Display available commands",
  action: () => {
    console.log("\nAvailable commands:");
    console.log("=================");
    
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
    console.log("\nBasic commands:");
    for (const { name, cmd } of basicCommands) {
      console.log(`  ${name.padEnd(12)} ${cmd.description}`);
    }
    
    // Display commands with subcommands
    console.log("\nCommands with subcommands:");
    for (const { name, cmd } of commandsWithSubcommands) {
      console.log(`  ${name.padEnd(12)} ${cmd.description}`);
      
      // Show available subcommands
      if (cmd.subcommands) {
        for (const [subName, subCmd] of cmd.subcommands) {
          console.log(`    ${name} ${subName.padEnd(10)} ${subCmd.description}`);
        }
      }
    }
    
    console.log("\nFeatures:");
    console.log("  - Use up/down arrows for command history");
    console.log("  - Press Tab for command completion");
    console.log("  - Use '/exit' to quit");
  },
});

// Start the shell
await shell.start();
