import { commandRegistry, type CommandOptions } from "./commands.ts";

/**
 * Interface for service configuration
 */
export interface ServiceConfig {
  name: string;
  commands: ServiceCommand[];
  init?: () => Promise<void>;
  cleanup?: () => Promise<void>;
}

/**
 * Interface for service command definition
 */
export interface ServiceCommand {
  name: string;
  description: string;
  action: (...args: unknown[]) => void | Promise<void>;
}

/**
 * Service registry for managing service integrations
 */
export class ServiceRegistry {
  private services: Map<string, ServiceConfig>;

  constructor() {
    this.services = new Map();
  }

  /**
   * Register a new service
   * @param config Service configuration
   */
  async registerService(config: ServiceConfig): Promise<void> {
    // Initialize service if needed
    if (config.init) {
      await config.init();
    }

    // Register service commands
    for (const cmd of config.commands) {
      const commandOptions: CommandOptions = {
        description: cmd.description,
        action: cmd.action,
      };
      commandRegistry.register(`${config.name} ${cmd.name}`, commandOptions);
    }

    // Store service configuration
    this.services.set(config.name, config);
  }

  /**
   * Unregister a service and cleanup
   * @param name Service name
   */
  async unregisterService(name: string): Promise<void> {
    const service = this.services.get(name);
    if (service?.cleanup) {
      await service.cleanup();
    }
    this.services.delete(name);
  }

  /**
   * Get all registered services
   */
  getServices(): Map<string, ServiceConfig> {
    return this.services;
  }
}

// Create and export default registry instance
export const serviceRegistry = new ServiceRegistry();