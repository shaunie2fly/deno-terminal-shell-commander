import { Shell } from "./src/shell.ts";
import { commandRegistry } from "./src/commands.ts";

// Create the shell instance
const shell = new Shell({
  name: "Demo Shell",
  prompt: "demo> ",
});

// Register commands
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

commandRegistry.register("help", {
  description: "Display available commands",
  action: () => {
    console.log("\nAvailable commands:");
    console.log("=================");
    for (const [name, cmd] of commandRegistry.getCommands()) {
      console.log(`  ${name.padEnd(12)} ${cmd.description}`);
    }
    console.log("\nUse up/down arrows for command history");
    console.log("Use '/exit' to quit");
  },
});

// Start the shell
await shell.start();
