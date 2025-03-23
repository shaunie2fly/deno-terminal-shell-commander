import { ServiceConfig, ServiceCommand } from "../services.ts";
import { taskManager, type BackgroundTask, TaskStatus } from "../tasks.ts";
import { outputManager } from "../output/stream.ts";

interface FileStats {
  isFile: boolean;
  isDirectory: boolean;
  size: number;
  modified: Date;
  created: Date;
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
 * File System Service
 * Provides file system operations as commands
 */
export class FileSystemService {
  private commands: ServiceCommand[];
  private path = "."

  constructor() {
    this.commands = [
      {
        name: "ls",
        description: "List directory contents",
        action: async (...args: unknown[]) => {
          await this.listDirectory(...validateStringArgs(args));
        },
      },
      {
        name: "cd",
        description: "Change current directory",
        action: async (...args: unknown[]) => {
          await this.changeDirectory(...validateStringArgs(args));
        },
      },
      {
        name: "cat",
        description: "Display file contents",
        action: async (...args: unknown[]) => {
          await this.displayFile(...validateStringArgs(args));
        },
      },
      {
        name: "cp",
        description: "Copy files or directories",
        action: async (...args: unknown[]) => {
          await this.copyFile(...validateStringArgs(args));
        },
      },
      {
        name: "mv",
        description: "Move files or directories",
        action: async (...args: unknown[]) => {
          await this.moveFile(...validateStringArgs(args));
        },
      },
      {
        name: "rm",
        description: "Remove files or directories",
        action: async (...args: unknown[]) => {
          await this.removeFile(...validateStringArgs(args));
        },
      },
      {
        name: "mkdir",
        description: "Create new directory",
        action: async (...args: unknown[]) => {
          await this.makeDirectory(...validateStringArgs(args));
        },
      },
      {
        name: "pwd",
        description: "Print working directory",
        action: this.printWorkingDirectory.bind(this),
      },
    ];
  }

  /**
   * Get service configuration
   */
  getConfig(): ServiceConfig {
    return {
      name: "fs",
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
    // Verify file system access
    try {
      const stat = await Deno.stat(this.path);
      if (!stat.isDirectory) {
        throw new Error("Working path is not a directory");
      }
    } catch (error) {
      const errorMessage = error instanceof Error 
        ? error.message 
        : 'Unknown error during initialization';
      throw new Error(`File system access error: ${errorMessage}`);
    }
  }

  /**
   * Health check
   */
  private async checkHealth(): Promise<boolean> {
    try {
      await Deno.stat(this.path);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Cleanup service
   */
  private async cleanup(): Promise<void> {
    // No cleanup needed
  }

  /**
   * List directory contents
   */
  private async listDirectory(...args: string[]): Promise<void> {
    const path = args[0] || this.path;
    const output = outputManager.createStream({ 
      buffered: true, 
      formatted: true 
    });

    try {
      const entries = [];
      for await (const entry of Deno.readDir(path)) {
        const stat = await Deno.stat(`${path}/${entry.name}`);
        entries.push({
          name: entry.name,
          isDir: entry.isDirectory,
          size: stat.size,
          modified: stat.mtime,
        });
      }

      // Format and write output
      for (const entry of entries) {
        output.write(
          `${entry.isDir ? "d" : "-"} ${entry.name.padEnd(30)} ${
            entry.size.toString().padStart(10)
          } ${entry.modified?.toLocaleString() || ""}\n`
        );
      }
    } catch (error) {
      const errorMessage = error instanceof Error 
        ? error.message 
        : 'Unknown error during directory listing';
      output.write(`Error listing directory: ${errorMessage}\n`);
    }
  }

  /**
   * Change current directory
   */
  private async changeDirectory(...args: string[]): Promise<void> {
    if (!args[0]) {
      throw new Error("Directory path required");
    }

    try {
      const newPath = args[0];
      const stat = await Deno.stat(newPath);
      if (!stat.isDirectory) {
        throw new Error("Path is not a directory");
      }
      this.path = newPath;
    } catch (error) {
      const errorMessage = error instanceof Error 
        ? error.message 
        : 'Unknown error during directory change';
      throw new Error(`Failed to change directory: ${errorMessage}`);
    }
  }

  /**
   * Display file contents
   */
  private async displayFile(...args: string[]): Promise<void> {
    if (!args[0]) {
      throw new Error("File path required");
    }

    const output = outputManager.createStream({ 
      buffered: true, 
      formatted: true 
    });

    try {
      const content = await Deno.readTextFile(args[0]);
      output.write(content);
    } catch (error) {
      const errorMessage = error instanceof Error 
        ? error.message 
        : 'Unknown error during file read';
      output.write(`Error reading file: ${errorMessage}\n`);
    }
  }

  /**
   * Copy file or directory
   */
  private async copyFile(...args: string[]): Promise<void> {
    if (args.length < 2) {
      throw new Error("Source and destination paths required");
    }

    const [src, dest] = args;
    const task: BackgroundTask = {
      id: `copy-${Date.now()}`,
      status: TaskStatus.PENDING,
      progress: 0,
      cancel: async () => {
        // Implement cancellation
      },
      onProgress: () => {},
      onComplete: () => {},
    };

    taskManager.schedule(task);

    try {
      await Deno.copyFile(src, dest);
      task.progress = 100;
      task.status = TaskStatus.COMPLETED;
    } catch (error) {
      task.status = TaskStatus.FAILED;
      const errorMessage = error instanceof Error 
        ? error.message 
        : 'Unknown error during file copy';
      throw new Error(`Failed to copy file: ${errorMessage}`);
    }
  }

  /**
   * Move file or directory
   */
  private async moveFile(...args: string[]): Promise<void> {
    if (args.length < 2) {
      throw new Error("Source and destination paths required");
    }

    try {
      await Deno.rename(args[0], args[1]);
    } catch (error) {
      const errorMessage = error instanceof Error 
        ? error.message 
        : 'Unknown error during file move';
      throw new Error(`Failed to move file: ${errorMessage}`);
    }
  }

  /**
   * Remove file or directory
   */
  private async removeFile(...args: string[]): Promise<void> {
    if (!args[0]) {
      throw new Error("Path required");
    }

    try {
      await Deno.remove(args[0], { recursive: true });
    } catch (error) {
      const errorMessage = error instanceof Error 
        ? error.message 
        : 'Unknown error during file removal';
      throw new Error(`Failed to remove: ${errorMessage}`);
    }
  }

  /**
   * Create new directory
   */
  private async makeDirectory(...args: string[]): Promise<void> {
    if (!args[0]) {
      throw new Error("Directory path required");
    }

    try {
      await Deno.mkdir(args[0], { recursive: true });
    } catch (error) {
      const errorMessage = error instanceof Error 
        ? error.message 
        : 'Unknown error during directory creation';
      throw new Error(`Failed to create directory: ${errorMessage}`);
    }
  }

  /**
   * Print working directory
   */
  private async printWorkingDirectory(): Promise<void> {
    const output = outputManager.createStream({ 
      buffered: false, 
      formatted: true 
    });
    output.write(`${this.path}\n`);
  }
}

// Export default service instance
export const fileSystemService = new FileSystemService();