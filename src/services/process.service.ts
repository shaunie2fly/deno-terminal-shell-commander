import { ServiceConfig, ServiceCommand } from "../services.ts";
import { taskManager, type BackgroundTask, TaskStatus } from "../tasks.ts";
import { outputManager } from "../output/stream.ts";

interface ProcessInfo {
  id: string;
  cmd: string[];
  status: ProcessStatus;
  pid?: number;
}

enum ProcessStatus {
  STARTING = "starting",
  RUNNING = "running",
  STOPPED = "stopped",
  FAILED = "failed"
}

// Helper function to validate string arguments
function validateStringArgs(args: unknown[]): string[] {
  return args.map(arg => {
    if (typeof arg !== 'string') {
      throw new Error('Invalid argument type: string required');
    }
    return arg;
  });
}

/**
 * Process Management Service
 * Provides process control and monitoring
 */
export class ProcessService {
  private commands: ServiceCommand[];
  private processes: Map<string, ProcessInfo>;
  private childProcesses: Map<string, Deno.ChildProcess>;

  constructor() {
    this.processes = new Map();
    this.childProcesses = new Map();
    this.commands = [
      {
        name: "ps",
        description: "List running processes",
        action: async () => {
          await this.listProcesses();
        },
      },
      {
        name: "run",
        description: "Run a command",
        action: async (...args: unknown[]) => {
          await this.runCommand(...validateStringArgs(args));
        },
      },
      {
        name: "kill",
        description: "Terminate a process",
        action: async (...args: unknown[]) => {
          const validArgs = validateStringArgs(args);
          await this.killProcess(validArgs[0]);
        },
      },
      {
        name: "bg",
        description: "Run command in background",
        action: async (...args: unknown[]) => {
          await this.runBackground(...validateStringArgs(args));
        },
      },
    ];
  }

  /**
   * Get service configuration
   */
  getConfig(): ServiceConfig {
    return {
      name: "process",
      version: { major: 1, minor: 0, patch: 0 },
      commands: this.commands,
      init: this.initialize.bind(this),
      healthCheck: this.checkHealth.bind(this),
      cleanup: this.cleanup.bind(this),
    };
  }

  /**
   * Initialize service
   */
  private async initialize(): Promise<void> {
    // No initialization needed
  }

  /**
   * Health check
   */
  private async checkHealth(): Promise<boolean> {
    // Service is healthy if we can access process APIs
    try {
      Deno.pid;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Cleanup service
   */
  private async cleanup(): Promise<void> {
    // Terminate all running processes
    for (const [id, child] of this.childProcesses) {
      try {
        child.kill("SIGTERM");
      } catch {
        // Ignore cleanup errors
      }
    }
    this.processes.clear();
    this.childProcesses.clear();
  }

  /**
   * List running processes
   */
  private async listProcesses(): Promise<void> {
    const output = outputManager.createStream({
      buffered: true,
      formatted: true,
    });

    output.write("Running Processes:\n");
    for (const [id, info] of this.processes) {
      output.write(`${id}: ${info.cmd.join(' ')} (${info.status})\n`);
    }
  }

  /**
   * Run a command
   */
  private async runCommand(...args: string[]): Promise<void> {
    if (args.length === 0) {
      throw new Error("Command required");
    }

    const output = outputManager.createStream({
      buffered: true,
      formatted: true,
    });

    try {
      const cmd = new Deno.Command(args[0], {
        args: args.slice(1),
        stdout: "piped",
        stderr: "piped",
      });

      const child = await cmd.output();

      if (child.stderr.length > 0) {
        output.write(new TextDecoder().decode(child.stderr));
      }
      if (child.stdout.length > 0) {
        output.write(new TextDecoder().decode(child.stdout));
      }

      if (!child.success) {
        throw new Error(`Command failed with status: ${child.code}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error 
        ? error.message 
        : 'Unknown error running command';
      throw new Error(`Failed to execute command: ${errorMessage}`);
    }
  }

  /**
   * Run a command in the background
   */
  private async runBackground(...args: string[]): Promise<void> {
    if (args.length === 0) {
      throw new Error("Command required");
    }

    const processId = `process-${Date.now()}`;
    const task: BackgroundTask = {
      id: processId,
      status: TaskStatus.PENDING,
      progress: 0,
      cancel: async () => {
        await this.killProcess(processId);
      },
      onProgress: () => {},
      onComplete: () => {},
    };

    taskManager.schedule(task);

    try {
      const cmd = new Deno.Command(args[0], {
        args: args.slice(1),
        stdout: "piped",
        stderr: "piped",
      });

      const processInfo: ProcessInfo = {
        id: processId,
        cmd: [args[0], ...args.slice(1)],
        status: ProcessStatus.STARTING
      };

      this.processes.set(processId, processInfo);
      
      const child = cmd.spawn();
      this.childProcesses.set(processId, child);
      
      processInfo.status = ProcessStatus.RUNNING;
      processInfo.pid = child.pid;
      task.status = TaskStatus.RUNNING;

      // Handle process completion
      const status = await child.status;
      
      processInfo.status = status.success ? ProcessStatus.STOPPED : ProcessStatus.FAILED;
      this.processes.set(processId, processInfo);
      this.childProcesses.delete(processId);

      task.progress = 100;
      task.status = status.success ? TaskStatus.COMPLETED : TaskStatus.FAILED;
    } catch (error) {
      const errorMessage = error instanceof Error 
        ? error.message 
        : 'Unknown error starting process';
      
      this.processes.delete(processId);
      this.childProcesses.delete(processId);
      task.status = TaskStatus.FAILED;
      
      throw new Error(`Failed to start process: ${errorMessage}`);
    }
  }

  /**
   * Kill a process
   */
  private async killProcess(id: string): Promise<void> {
    const process = this.processes.get(id);
    const child = this.childProcesses.get(id);

    if (!process || !child) {
      throw new Error(`No such process: ${id}`);
    }

    try {
      child.kill("SIGTERM");
      process.status = ProcessStatus.STOPPED;
      this.childProcesses.delete(id);
    } catch (error) {
      const errorMessage = error instanceof Error 
        ? error.message 
        : 'Unknown error killing process';
      throw new Error(`Failed to kill process: ${errorMessage}`);
    }
  }
}

// Export default service instance
export const processService = new ProcessService();