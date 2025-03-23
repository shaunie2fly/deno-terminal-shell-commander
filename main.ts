import { Shell } from "./src/shell.ts";
import { commandRegistry, CommandOptions } from "./src/commands.ts";
import { serviceRegistry, ServiceStatus } from "./src/services.ts";
import { fileSystemService } from "./src/services/fs.service.ts";
import { processService } from "./src/services/process.service.ts";
import { examplesService } from "./src/services/examples.service.ts";
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

// Add state management subcommands
serviceSubcommands.set("state", {
  description: "Display detailed service state",
  action: async (...args: string[]) => {
    const name = args[0];
    if (name) {
      // Show state for a specific service
      const state = serviceRegistry.getServiceState(name);
      if (state) {
        const output = [
          colors.formatHelpTitle(`State for service: ${name}`),
          colors.border(60),
          `Status: ${colors.formatInfo(state.status)}`,
          `Last Check: ${colors.formatInfo(state.health.lastCheck.toLocaleString())}`,
          `Error Count: ${colors.formatInfo(state.health.errors.length.toString())}`,
          state.health.errors.length > 0 ? `Last Error: ${colors.formatWarning(state.health.errors[state.health.errors.length - 1])}` : '',
          colors.border(60),
          "Metadata:",
        ];
        
        // Add metadata properties
        for (const [key, value] of Object.entries(state.metadata)) {
          output.push(`  ${key}: ${colors.formatInfo(String(value))}`);
        }
        
        shell.writeOutput(output.filter(Boolean).join('\n') + '\n');
      } else {
        shell.writeOutput(colors.formatError("Error", `Service '${name}' not found`) + '\n');
      }
    } else {
      // Show states for all services
      const services = serviceRegistry.getAllServiceStates();
      if (services.size === 0) {
        shell.writeOutput(colors.formatWarning("No services registered.") + '\n');
        return;
      }
      
      const output = [colors.formatHelpTitle("All Service States:")];
      
      for (const [name, state] of services) {
        output.push(
          colors.border(40),
          `Service: ${colors.formatHelpCommand(name)}`,
          `Status: ${getStatusColor(state.status, state.status)}`,
          `Errors: ${state.health.errors.length > 0 ? colors.formatWarning(state.health.errors.length.toString()) : colors.formatSuccess('0')}`
        );
      }
      
      shell.writeOutput(output.join('\n') + '\n');
    }
  }
});

serviceSubcommands.set("health", {
  description: "Check service health",
  action: async (...args: string[]) => {
    const name = args[0];
    if (name) {
      // Check health for a specific service
      try {
        const healthy = await serviceRegistry.checkServiceHealth(name);
        const state = serviceRegistry.getServiceState(name);
        if (state) {
          const output = [
            colors.formatHelpTitle(`Health check for service: ${name}`),
            `Result: ${healthy ? colors.formatSuccess("HEALTHY") : colors.formatError("Error", "UNHEALTHY")}`,
            `Current Status: ${getStatusColor(state.status, state.status)}`
          ];
          
          if (!healthy && state.health.errors.length > 0) {
            output.push(`Last Error: ${colors.formatWarning(state.health.errors[state.health.errors.length - 1])}`);
          }
          
          shell.writeOutput(output.join('\n') + '\n');
        } else {
          shell.writeOutput(colors.formatError("Error", `Service '${name}' not found`) + '\n');
        }
      } catch (error) {
        shell.writeOutput(colors.formatError("Error", `Failed to check health: ${error instanceof Error ? error.message : String(error)}`) + '\n');
      }
    } else {
      // Check health for all services
      const services = serviceRegistry.getServices();
      if (services.size === 0) {
        shell.writeOutput(colors.formatWarning("No services registered.") + '\n');
        return;
      }
      
      const output = [colors.formatHelpTitle("Health Check Results:")];
      
      for (const [name] of services) {
        const healthy = await serviceRegistry.checkServiceHealth(name);
        const state = serviceRegistry.getServiceState(name);
        if (state) {
          output.push(
            `${name.padEnd(15)}: ${healthy ? colors.formatSuccess("HEALTHY") : colors.formatError("Error", "UNHEALTHY")}`,
            `  Status: ${getStatusColor(state.status, state.status)}`
          );
          
          if (!healthy && state.health.errors.length > 0) {
            output.push(`  Last Error: ${colors.formatWarning(state.health.errors[state.health.errors.length - 1])}`);
          }
        }
      }
      
      shell.writeOutput(output.join('\n') + '\n');
    }
  }
});

serviceSubcommands.set("monitor", {
  description: "Monitor service health (runs every 5s)",
  action: async (...args: string[]) => {
    const serviceName = args[0];
    const interval = parseInt(args[1] || "5000", 10);
    
    if (isNaN(interval) || interval < 1000) {
      shell.writeOutput(colors.formatError("Error", "Invalid interval. Must be at least 1000ms.") + '\n');
      return;
    }
    
    // Start monitoring
    shell.writeOutput(colors.formatExecuting(`Starting health monitoring ${serviceName ? `for ${serviceName}` : 'for all services'} (interval: ${interval}ms)`) + '\n');
    shell.writeOutput(colors.formatInfo("Press Ctrl+C to stop monitoring.") + '\n');
    
    // Create a unique task ID for this monitoring session
    const taskId = `health-monitor-${Date.now()}`;
    
    // Define the monitor function
    const monitorFunction = async () => {
      const services = serviceName 
        ? (serviceRegistry.getServiceState(serviceName) ? [serviceName] : [])
        : Array.from(serviceRegistry.getServices().keys());
      
      if (services.length === 0) {
        shell.writeOutput(colors.formatWarning(`No ${serviceName ? `service named '${serviceName}'` : 'services'} found.`) + '\n');
        return;
      }
      
      const output = [colors.formatHelpTitle(`Health Check at ${new Date().toLocaleTimeString()}:`)];
      
      for (const name of services) {
        const healthy = await serviceRegistry.checkServiceHealth(name);
        const state = serviceRegistry.getServiceState(name);
        
        if (state) {
          output.push(
            `${name.padEnd(15)}: ${healthy ? colors.formatSuccess("HEALTHY") : colors.formatError("Error", "UNHEALTHY")}`,
            `  Status: ${getStatusColor(state.status, state.status)}`
          );
          
          if (!healthy && state.health.errors.length > 0) {
            output.push(`  Last Error: ${colors.formatWarning(state.health.errors[state.health.errors.length - 1])}`);
          }
        }
      }
      
      shell.writeOutput(output.join('\n') + '\n');
    };
    
    // Run the first check immediately
    await monitorFunction();
    
    // Set up interval for continuous monitoring
    const intervalId = setInterval(monitorFunction, interval);
    
    // Store the interval ID in metadata
    const shellState = serviceRegistry.getServiceState("shell");
    if (shellState) {
      if (!shellState.metadata.monitoringIntervals) {
        shellState.metadata.monitoringIntervals = [];
      }
      (shellState.metadata.monitoringIntervals as number[]).push(intervalId);
    }
  }
});

serviceSubcommands.set("recover", {
  description: "Attempt to recover a service",
  action: async (...args: string[]) => {
    const name = args[0];
    
    if (!name) {
      shell.writeOutput(colors.formatError("Error", "Service name required") + '\n');
      return;
    }
    
    const state = serviceRegistry.getServiceState(name);
    if (!state) {
      shell.writeOutput(colors.formatError("Error", `Service '${name}' not found`) + '\n');
      return;
    }
    
    if (state.status !== ServiceStatus.ERROR && state.status !== ServiceStatus.DEGRADED) {
      shell.writeOutput(colors.formatWarning(`Service '${name}' is currently ${state.status}. Only ERROR or DEGRADED services need recovery.`) + '\n');
      return;
    }
    
    shell.writeOutput(colors.formatExecuting(`Attempting to recover service '${name}'...`) + '\n');
    
    try {
      // Preserve metadata
      const metadata = { ...state.metadata };
      
      // Unregister the service
      await serviceRegistry.unregisterService(name);
      shell.writeOutput(colors.formatInfo(`Service '${name}' stopped.`) + '\n');
      
      // Wait for cleanup to complete
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Re-register the service
      const service = serviceRegistry.getServices().get(name);
      if (service) {
        await serviceRegistry.registerService(service);
        shell.writeOutput(colors.formatSuccess(`Service '${name}' re-registered.`) + '\n');
        
        // Restore metadata
        const newState = serviceRegistry.getServiceState(name);
        if (newState) {
          newState.metadata = metadata;
          shell.writeOutput(colors.formatInfo(`Service metadata restored.`) + '\n');
        }
        
        // Check health
        const healthy = await serviceRegistry.checkServiceHealth(name);
        shell.writeOutput(healthy 
          ? colors.formatSuccess(`Service '${name}' recovered successfully.`) 
          : colors.formatWarning(`Service '${name}' restarted but health check failed.`)
        );
        shell.writeOutput('\n');
      } else {
        shell.writeOutput(colors.formatError("Error", `Failed to re-register service '${name}'.`) + '\n');
      }
    } catch (error) {
      shell.writeOutput(colors.formatError("Recovery Failed", `Error: ${error instanceof Error ? error.message : String(error)}`) + '\n');
    }
  }
});

serviceSubcommands.set("metadata", {
  description: "View or update service metadata",
  action: async (...args: string[]) => {
    const [name, key, value] = args;
    
    if (!name) {
      shell.writeOutput(colors.formatError("Error", "Service name required") + '\n');
      return;
    }
    
    const state = serviceRegistry.getServiceState(name);
    if (!state) {
      shell.writeOutput(colors.formatError("Error", `Service '${name}' not found`) + '\n');
      return;
    }
    
    // Update metadata if key and value are provided
    if (key && value !== undefined) {
      state.metadata = { ...state.metadata, [key]: value };
      shell.writeOutput(colors.formatSuccess(`Metadata updated for service '${name}'`) + '\n');
    }
    
    // Display metadata
    const output = [
      colors.formatHelpTitle(`Metadata for service: ${name}`),
      colors.border(60)
    ];
    
    if (Object.keys(state.metadata).length === 0) {
      output.push(colors.formatInfo("No metadata available"));
    } else {
      for (const [k, v] of Object.entries(state.metadata)) {
        output.push(`${k}: ${colors.formatInfo(String(v))}`);
      }
    }
    
    shell.writeOutput(output.join('\n') + '\n');
  }
});

// Helper function to colorize status based on state
function getStatusColor(status: string, text: string): string {
  switch (status) {
    case ServiceStatus.RUNNING:
      return colors.formatSuccess(text);
    case ServiceStatus.INITIALIZING:
    case ServiceStatus.STOPPED:
      return colors.formatInfo(text);
    case ServiceStatus.DEGRADED:
      return colors.formatWarning(text);
    case ServiceStatus.ERROR:
      return colors.formatError("Error", text);
    default:
      return text;
  }
}

// Register the service command with its subcommands
commandRegistry.register("service", {
  description: "Service management",
  action: () => {
    const output = [
      colors.formatHelpTitle("Service command usage:"),
      colors.border(60),
      colors.header("Basic Service Management:"),
      `  ${colors.formatHelpCommand("service start")}    - ${colors.formatHelpDescription("Start a service")}`,
      `  ${colors.formatHelpCommand("service stop")}     - ${colors.formatHelpDescription("Stop a service")}`,
      `  ${colors.formatHelpCommand("service restart")}  - ${colors.formatHelpDescription("Restart a service")}`,
      `  ${colors.formatHelpCommand("service status")}   - ${colors.formatHelpDescription("Show service status")}`,
      colors.border(60),
      colors.header("State Management:"),
      `  ${colors.formatHelpCommand("service state")}    - ${colors.formatHelpDescription("Display detailed service state")}`,
      `  ${colors.formatHelpCommand("service health")}   - ${colors.formatHelpDescription("Check service health")}`,
      `  ${colors.formatHelpCommand("service monitor")}  - ${colors.formatHelpDescription("Monitor service health over time")}`,
      `  ${colors.formatHelpCommand("service recover")}  - ${colors.formatHelpDescription("Attempt to recover a service")}`,
      `  ${colors.formatHelpCommand("service metadata")} - ${colors.formatHelpDescription("View or update service metadata")}`
    ].filter(Boolean);
    shell.writeOutput(output.join('\n') + '\n');
  },
  subcommands: serviceSubcommands
});

// Examples command with subcommands
const examplesSubcommands = new Map<string, CommandOptions>();

examplesSubcommands.set("list", {
  description: "List all examples",
  action: async () => {
    await commandRegistry.executeCommand("examples list");
  },
});

examplesSubcommands.set("get", {
  description: "Get example by ID",
  action: async (...args: string[]) => {
    await commandRegistry.executeCommand(`examples get ${args.join(' ')}`);
  },
});

examplesSubcommands.set("create", {
  description: "Create a new example",
  action: async (...args: string[]) => {
    await commandRegistry.executeCommand(`examples create ${args.join(' ')}`);
  },
});

examplesSubcommands.set("update", {
  description: "Update an example",
  action: async (...args: string[]) => {
    await commandRegistry.executeCommand(`examples update ${args.join(' ')}`);
  },
});

examplesSubcommands.set("delete", {
  description: "Delete an example",
  action: async (...args: string[]) => {
    await commandRegistry.executeCommand(`examples delete ${args.join(' ')}`);
  },
});

examplesSubcommands.set("simulate", {
  description: "Simulate status changes",
  action: async (...args: string[]) => {
    await commandRegistry.executeCommand(`examples simulate ${args.join(' ')}`);
  },
});

// Register the examples command with its subcommands
commandRegistry.register("examples", {
  description: "State management examples",
  action: () => {
    const output = [
      colors.formatHelpTitle("Examples command usage:"),
      colors.border(60),
      `  ${colors.formatHelpCommand("examples list")}    - ${colors.formatHelpDescription("List all examples")}`,
      `  ${colors.formatHelpCommand("examples get")}     - ${colors.formatHelpDescription("Get example by ID")}`,
      `  ${colors.formatHelpCommand("examples create")}  - ${colors.formatHelpDescription("Create a new example with name and value")}`,
      `  ${colors.formatHelpCommand("examples update")}  - ${colors.formatHelpDescription("Update an example (id, field, value)")}`,
      `  ${colors.formatHelpCommand("examples delete")}  - ${colors.formatHelpDescription("Delete an example by ID")}`,
      `  ${colors.formatHelpCommand("examples simulate")}- ${colors.formatHelpDescription("Simulate service status changes")}`,
    ].filter(Boolean);
    shell.writeOutput(output.join('\n') + '\n');
  },
  subcommands: examplesSubcommands
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
      } else if (!name.includes(" ")) { // Only include top-level commands in basic section
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
      `  ${colors.formatInfo("- Use '/clear' or 'clear' to clear the screen")}`,
      `  ${colors.formatInfo("- Try the 'colors' command to see color formatting options")}`
    ].join('\n');

    // Combine all sections with single newlines between them
    shell.writeOutput(`${header}\n${basicCommandsSection}\n${subcommandsSection}\n${featuresSection}\n`);
  },
});

// Register services
await serviceRegistry.registerService(fileSystemService.getConfig());
await serviceRegistry.registerService(processService.getConfig());
await serviceRegistry.registerService(examplesService.getConfig());
shell.writeOutput(colors.formatSuccess("Services registered successfully\n"));

// Start the shell
await shell.start();
