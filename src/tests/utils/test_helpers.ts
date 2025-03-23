import { outputManager } from "../../output/stream.ts";
import { taskManager, TaskStatus } from "../../tasks.ts";
import { serviceRegistry, ServiceConfig } from "../../services.ts";

/**
 * Test output capture helper
 */
export function captureOutput(): { output: string; stream: unknown } {
  let captured = "";
  const stream = outputManager.createStream({
    buffered: true,
    formatted: false,
  });

  stream.onData((data: string) => {
    captured += data;
  });

  return {
    output: captured,
    stream,
  };
}

/**
 * Task completion helper
 */
export async function waitForTask(taskId: string, timeout = 5000): Promise<TaskStatus> {
  const start = Date.now();
  
  while (Date.now() - start < timeout) {
    const status = taskManager.getStatus(taskId);
    if (status === TaskStatus.COMPLETED || status === TaskStatus.FAILED) {
      return status;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  
  throw new Error(`Task ${taskId} did not complete within ${timeout}ms`);
}

/**
 * Temporary test directory helper
 */
export async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const tempDir = await Deno.makeTempDir();
  try {
    await fn(tempDir);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
}

/**
 * Service registration helper
 */
export async function withService<T>(
  service: { getConfig: () => ServiceConfig },
  fn: () => Promise<void>,
): Promise<void> {
  const config = service.getConfig();
  await serviceRegistry.registerService(config);
  try {
    await fn();
  } finally {
    await serviceRegistry.unregisterService(config.name);
  }
}

/**
 * Mock process helper for testing process service
 */
export class MockProcess {
  private terminated = false;
  
  async run(duration = 1000): Promise<void> {
    const start = Date.now();
    while (!this.terminated && Date.now() - start < duration) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  terminate(): void {
    this.terminated = true;
  }

  isTerminated(): boolean {
    return this.terminated;
  }
}