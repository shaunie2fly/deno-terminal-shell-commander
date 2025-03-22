/**
 * Interface for command registration options
 */
export interface CommandOptions {
  description: string;
  action: () => void | Promise<void>;
}

/**
 * Command registry for managing shell commands
 */
export class CommandRegistry {
  private commands: Map<string, CommandOptions>;

  constructor() {
    this.commands = new Map();
  }

  /**
   * Register a new command
   */
  register(name: string, options: CommandOptions): void {
    this.commands.set(name, options);
  }

  /**
   * Execute a command
   */
  async executeCommand(commandName: string): Promise<boolean> {
    const command = this.commands.get(commandName);
    if (command) {
      await command.action();
      return true;
    }
    return false;
  }

  /**
   * Get possible command suggestions for a partial command
   */
  getSuggestions(partial: string): string[] {
    const suggestions: string[] = [];
    for (const name of this.commands.keys()) {
      if (name.startsWith(partial)) {
        suggestions.push(name);
      }
    }
    return suggestions;
  }

  /**
   * Get command description
   */
  getDescription(commandName: string): string | undefined {
    return this.commands.get(commandName)?.description;
  }

  /**
   * Get all registered commands
   */
  getCommands(): Map<string, CommandOptions> {
    return this.commands;
  }
}

// Create and export default registry instance
export const commandRegistry = new CommandRegistry();