/**
 * Task status enumeration
 */
export enum TaskStatus {
  PENDING = "pending",
  RUNNING = "running",
  COMPLETED = "completed",
  FAILED = "failed",
  CANCELLED = "cancelled"
}

/**
 * Background task interface
 */
export interface BackgroundTask {
  id: string;
  status: TaskStatus;
  progress: number;
  cancel: () => Promise<void>;
  onProgress: (callback: (progress: number) => void) => void;
  onComplete: (callback: (result: unknown) => void) => void;
}

/**
 * Task event types
 */
type TaskEventType = "progress" | "complete" | "error";

/**
 * Task event listener
 */
type TaskEventListener = (task: BackgroundTask, data?: unknown) => void;

/**
 * Task manager for handling background tasks
 */
export class TaskManager {
  private tasks: Map<string, BackgroundTask>;
  private eventListeners: Map<TaskEventType, Set<TaskEventListener>>;

  constructor() {
    this.tasks = new Map();
    this.eventListeners = new Map();
  }

  /**
   * Schedule a new background task
   */
  schedule(task: BackgroundTask): void {
    this.tasks.set(task.id, task);
    
    // Setup progress tracking
    task.onProgress((progress: number) => {
      this.notifyListeners("progress", task);
    });

    // Setup completion handling
    task.onComplete((result: unknown) => {
      task.status = TaskStatus.COMPLETED;
      this.notifyListeners("complete", task, result);
    });
  }

  /**
   * Cancel a running task
   */
  async cancel(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (task) {
      await task.cancel();
      task.status = TaskStatus.CANCELLED;
      this.notifyListeners("complete", task);
    }
  }

  /**
   * Get task status
   */
  getStatus(taskId: string): TaskStatus | undefined {
    return this.tasks.get(taskId)?.status;
  }

  /**
   * Get all tasks
   */
  getTasks(): Map<string, BackgroundTask> {
    return this.tasks;
  }

  /**
   * Add event listener
   */
  addEventListener(type: TaskEventType, listener: TaskEventListener): void {
    if (!this.eventListeners.has(type)) {
      this.eventListeners.set(type, new Set());
    }
    this.eventListeners.get(type)?.add(listener);
  }

  /**
   * Remove event listener
   */
  removeEventListener(type: TaskEventType, listener: TaskEventListener): void {
    this.eventListeners.get(type)?.delete(listener);
  }

  /**
   * Notify listeners of task events
   */
  private notifyListeners(type: TaskEventType, task: BackgroundTask, data?: unknown): void {
    this.eventListeners.get(type)?.forEach(listener => {
      listener(task, data);
    });
  }

  /**
   * Clean up completed tasks
   */
  cleanup(): void {
    for (const [id, task] of this.tasks) {
      if (task.status === TaskStatus.COMPLETED || task.status === TaskStatus.CANCELLED) {
        this.tasks.delete(id);
      }
    }
  }
}

// Export default task manager instance
export const taskManager = new TaskManager();