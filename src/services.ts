import { commandRegistry, type CommandOptions } from "./commands.ts";

/**
 * Service health status
 */
export enum ServiceStatus {
  INITIALIZING = "initializing",
  RUNNING = "running",
  DEGRADED = "degraded",
  ERROR = "error",
  STOPPED = "stopped"
}

/**
 * Service state management
 */
export interface ServiceState {
  status: ServiceStatus;
  health: {
    lastCheck: Date;
    errors: string[];
  };
  metadata: Record<string, unknown>;
}

/**
 * Service version information
 */
export interface ServiceVersion {
  major: number;
  minor: number;
  patch: number;
}

/**
 * Service dependency definition
 */
export interface ServiceDependency {
  name: string;
  version?: ServiceVersion;
  required: boolean;
}

/**
 * Interface for service configuration
 */
export interface ServiceConfig {
  name: string;
  version: ServiceVersion;
  dependencies?: ServiceDependency[];
  commands: ServiceCommand[];
  init?: () => Promise<void>;
  healthCheck?: () => Promise<boolean>;
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
  private states: Map<string, ServiceState>;

  constructor() {
    this.services = new Map();
    this.states = new Map();
  }

  /**
   * Register a new service
   * @param config Service configuration
   */
  async registerService(config: ServiceConfig): Promise<void> {
    // Check dependencies
    if (config.dependencies) {
      for (const dep of config.dependencies) {
        const service = this.services.get(dep.name);
        if (!service && dep.required) {
          throw new Error(`Required dependency ${dep.name} not found`);
        }
      }
    }

    // Initialize service state
    this.states.set(config.name, {
      status: ServiceStatus.INITIALIZING,
      health: { lastCheck: new Date(), errors: [] },
      metadata: {}
    });

    // Initialize service if needed
    if (config.init) {
      try {
        await config.init();
        this.updateServiceStatus(config.name, ServiceStatus.RUNNING);
      } catch (error) {
        this.updateServiceStatus(config.name, ServiceStatus.ERROR);
        throw error;
      }
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
   * Update service status and health information
   * @param name Service name
   * @param status New status
   * @param error Optional error message
   */
  private updateServiceStatus(
    name: string,
    status: ServiceStatus,
    error?: string
  ): void {
    const state = this.states.get(name);
    if (state) {
      state.status = status;
      if (error) {
        state.health.errors.push(error);
      }
      state.health.lastCheck = new Date();
    }
  }

  /**
   * Get service state
   * @param name Service name
   */
  getServiceState(name: string): ServiceState | undefined {
    return this.states.get(name);
  }

  /**
   * Run health check for a service
   * @param name Service name
   */
  async checkServiceHealth(name: string): Promise<boolean> {
    const service = this.services.get(name);
    const state = this.states.get(name);
    
    if (service?.healthCheck && state) {
      try {
        const healthy = await service.healthCheck();
        this.updateServiceStatus(name, healthy ? ServiceStatus.RUNNING : ServiceStatus.DEGRADED);
        return healthy;
      } catch (error) {
        const errorMessage = error instanceof Error 
          ? error.message 
          : 'Unknown error during health check';
        this.updateServiceStatus(name, ServiceStatus.ERROR, errorMessage);
        return false;
      }
    }
    return false;
  }

  /**
   * Unregister a service and cleanup
   * @param name Service name
   */
  async unregisterService(name: string): Promise<void> {
    this.updateServiceStatus(name, ServiceStatus.STOPPED);
    const service = this.services.get(name);
    if (service?.cleanup) {
      await service.cleanup();
    }
    this.services.delete(name);
    this.states.delete(name);
  }

  /**
   * Get all registered services
   */
  getServices(): Map<string, ServiceConfig> {
    return this.services;
  }

  /**
   * Get all service states
   */
  getAllServiceStates(): Map<string, ServiceState> {
    return this.states;
  }
}

// Create and export default registry instance
export const serviceRegistry = new ServiceRegistry();