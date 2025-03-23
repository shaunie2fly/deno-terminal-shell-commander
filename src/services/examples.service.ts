import { ServiceCommand, ServiceConfig, ServiceStatus } from '../services.ts';
import { type BackgroundTask, taskManager, TaskStatus } from '../tasks.ts';
import { outputManager } from '../output/stream.ts';

/**
 * Interface for example data
 */
interface ExampleItem {
	id: string;
	name: string;
	status: ExampleStatus;
	value: number;
	createdAt: Date;
}

/**
 * Example status enumeration
 */
enum ExampleStatus {
	ACTIVE = 'active',
	INACTIVE = 'inactive',
	PENDING = 'pending',
}

// Helper function to validate string arguments
function validateStringArgs(args: unknown[]): string[] {
	return args.map((arg) => {
		if (typeof arg !== 'string') {
			throw new Error('Invalid argument type: string required');
		}
		return arg;
	});
}

/**
 * Examples Service
 * Provides state management demonstration examples
 */
export class ExamplesService {
	private commands: ServiceCommand[];
	private examples: Map<string, ExampleItem>;
	private memoryUsage: number;
	private healthCheckTimer?: number;
	private simulatedHealth: boolean;
	private operationCount: number;

	constructor() {
		this.examples = new Map();
		this.memoryUsage = 0;
		this.simulatedHealth = true;
		this.operationCount = 0;

		// Initialize with some example items
		this.examples.set('example-1', {
			id: 'example-1',
			name: 'Example One',
			status: ExampleStatus.ACTIVE,
			value: 100,
			createdAt: new Date(),
		});

		this.examples.set('example-2', {
			id: 'example-2',
			name: 'Example Two',
			status: ExampleStatus.INACTIVE,
			value: 50,
			createdAt: new Date(),
		});

		this.commands = [
			{
				name: 'list',
				description: 'List all examples',
				action: async () => {
					await this.listExamples();
				},
			},
			{
				name: 'get',
				description: 'Get example by ID',
				action: async (...args: unknown[]) => {
					const validArgs = validateStringArgs(args);
					await this.getExample(validArgs[0]);
				},
			},
			{
				name: 'create',
				description: 'Create a new example',
				action: async (...args: unknown[]) => {
					const validArgs = validateStringArgs(args);
					await this.createExample(validArgs[0], parseInt(validArgs[1] || '0', 10));
				},
			},
			{
				name: 'update',
				description: 'Update an example',
				action: async (...args: unknown[]) => {
					const validArgs = validateStringArgs(args);
					await this.updateExample(validArgs[0], validArgs[1], validArgs[2]);
				},
			},
			{
				name: 'delete',
				description: 'Delete an example',
				action: async (...args: unknown[]) => {
					const validArgs = validateStringArgs(args);
					await this.deleteExample(validArgs[0]);
				},
			},
			{
				name: 'simulate',
				description: 'Simulate status changes',
				action: async (...args: unknown[]) => {
					const validArgs = validateStringArgs(args);
					await this.simulateStatus(validArgs[0]);
				},
			},
		];
	}

	/**
	 * Get service configuration
	 */
	getConfig(): ServiceConfig {
		return {
			name: 'examples',
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
		// Simulate resource allocation
		this.memoryUsage = 100; // megabytes

		// Start periodic health check simulation
		this.healthCheckTimer = setInterval(() => {
			// Randomly change health status (10% chance of being unhealthy)
			this.simulatedHealth = Math.random() > 0.1;

			// Simulate memory growth
			this.memoryUsage += Math.floor(Math.random() * 10);

			// Simulate memory cleanup when it gets too high
			if (this.memoryUsage > 500) {
				this.memoryUsage = 100;
			}
		}, 30000) as unknown as number;

		const output = outputManager.createStream({
			buffered: false,
			formatted: true,
		});
		output.write('Examples service initialized\n');
	}

	/**
	 * Health check
	 */
	private async checkHealth(): Promise<boolean> {
		// Increment operation count to track usage
		this.operationCount++;

		// Service is healthy if our simulated health flag is true
		// and memory usage is below threshold
		return this.simulatedHealth && this.memoryUsage < 400;
	}

	/**
	 * Cleanup service
	 */
	private async cleanup(): Promise<void> {
		// Clear timer if it exists
		if (this.healthCheckTimer) {
			clearInterval(this.healthCheckTimer);
		}

		// Clear examples
		this.examples.clear();
		this.memoryUsage = 0;

		const output = outputManager.createStream({
			buffered: false,
			formatted: true,
		});
		output.write('Examples service resources released\n');
	}

	/**
	 * List all examples
	 */
	private async listExamples(): Promise<void> {
		const output = outputManager.createStream({
			buffered: true,
			formatted: true,
		});

		output.write('Examples:\n');

		if (this.examples.size === 0) {
			output.write('  No examples found\n');
			return;
		}

		for (const [id, example] of this.examples) {
			output.write(`  ${id}: ${example.name} (${example.status}) - Value: ${example.value}\n`);
		}

		// Update metadata with usage stats
		this.updateMetadata('lastOperation', 'listExamples');
		this.updateMetadata('totalExamples', this.examples.size);
	}

	/**
	 * Get example by ID
	 */
	private async getExample(id: string): Promise<void> {
		const output = outputManager.createStream({
			buffered: true,
			formatted: true,
		});

		const example = this.examples.get(id);
		if (!example) {
			output.write(`Error: Example with ID '${id}' not found\n`);
			return;
		}

		output.write(`Example Details:\n`);
		output.write(`  ID: ${example.id}\n`);
		output.write(`  Name: ${example.name}\n`);
		output.write(`  Status: ${example.status}\n`);
		output.write(`  Value: ${example.value}\n`);
		output.write(`  Created: ${example.createdAt.toLocaleString()}\n`);

		// Update metadata with usage stats
		this.updateMetadata('lastOperation', 'getExample');
		this.updateMetadata('lastViewedExample', id);
	}

	/**
	 * Create a new example
	 */
	private async createExample(name: string, value: number): Promise<void> {
		const output = outputManager.createStream({
			buffered: true,
			formatted: true,
		});

		if (!name) {
			output.write('Error: Example name is required\n');
			return;
		}

		const id = `example-${Date.now()}`;
		const example: ExampleItem = {
			id,
			name,
			status: ExampleStatus.PENDING,
			value: isNaN(value) ? 0 : value,
			createdAt: new Date(),
		};

		this.examples.set(id, example);

		// Create a background task to simulate processing
		const task: BackgroundTask = {
			id: `create-example-${id}`,
			status: TaskStatus.PENDING,
			progress: 0,
			cancel: async () => {
				// Implement cancellation
				this.examples.delete(id);
			},
			onProgress: () => {},
			onComplete: () => {},
		};

		taskManager.schedule(task);

		// Simulate processing time
		setTimeout(() => {
			// Update example status after a delay
			const updatedExample = this.examples.get(id);
			if (updatedExample) {
				updatedExample.status = ExampleStatus.ACTIVE;
				this.examples.set(id, updatedExample);
			}

			task.progress = 100;
			task.status = TaskStatus.COMPLETED;
		}, 2000);

		output.write(`Example created with ID: ${id}\n`);
		output.write(`Status will change from PENDING to ACTIVE shortly...\n`);

		// Update metadata with usage stats
		this.updateMetadata('lastOperation', 'createExample');
		this.updateMetadata('totalExamples', this.examples.size);
		this.updateMetadata('lastCreatedExample', id);
	}

	/**
	 * Update an example
	 */
	private async updateExample(id: string, field: string, value: string): Promise<void> {
		const output = outputManager.createStream({
			buffered: true,
			formatted: true,
		});

		const example = this.examples.get(id);
		if (!example) {
			output.write(`Error: Example with ID '${id}' not found\n`);
			return;
		}

		switch (field.toLowerCase()) {
			case 'name':
				example.name = value;
				break;
			case 'status':
				if (value === 'active') {
					example.status = ExampleStatus.ACTIVE;
				} else if (value === 'inactive') {
					example.status = ExampleStatus.INACTIVE;
				} else if (value === 'pending') {
					example.status = ExampleStatus.PENDING;
				} else {
					output.write(`Error: Invalid status value. Use "active", "inactive", or "pending"\n`);
					return;
				}
				break;
			case 'value':
				const numValue = parseInt(value, 10);
				if (isNaN(numValue)) {
					output.write(`Error: Value must be a number\n`);
					return;
				}
				example.value = numValue;
				break;
			default:
				output.write(`Error: Invalid field. Use "name", "status", or "value"\n`);
				return;
		}

		this.examples.set(id, example);
		output.write(`Example ${id} updated: ${field} set to ${value}\n`);

		// Update metadata with usage stats
		this.updateMetadata('lastOperation', 'updateExample');
		this.updateMetadata('lastUpdatedExample', id);
	}

	/**
	 * Delete an example
	 */
	private async deleteExample(id: string): Promise<void> {
		const output = outputManager.createStream({
			buffered: true,
			formatted: true,
		});

		if (!this.examples.has(id)) {
			output.write(`Error: Example with ID '${id}' not found\n`);
			return;
		}

		this.examples.delete(id);
		output.write(`Example ${id} deleted\n`);

		// Update metadata with usage stats
		this.updateMetadata('lastOperation', 'deleteExample');
		this.updateMetadata('totalExamples', this.examples.size);
		this.updateMetadata('lastDeletedExample', id);
	}

	/**
	 * Simulate service status changes
	 */
	private async simulateStatus(status: string): Promise<void> {
		const output = outputManager.createStream({
			buffered: true,
			formatted: true,
		});

		switch (status.toLowerCase()) {
			case 'healthy':
				this.simulatedHealth = true;
				output.write('Service health status set to HEALTHY\n');
				break;
			case 'unhealthy':
				this.simulatedHealth = false;
				output.write('Service health status set to UNHEALTHY\n');
				break;
			case 'memory-high':
				this.memoryUsage = 450; // Over threshold to trigger unhealthy state
				output.write('Service memory usage increased to simulate resource pressure\n');
				break;
			case 'memory-normal':
				this.memoryUsage = 100;
				output.write('Service memory usage reset to normal levels\n');
				break;
			case 'error':
				// Simulate an error condition by triggering an error and storing it
				try {
					throw new Error('Simulated error condition');
				} catch (error) {
					// This will be recorded in service state
					this.updateMetadata('lastError', (error as Error).message);
					this.updateMetadata('errorTime', new Date().toISOString());
					output.write('Simulated error condition triggered\n');
				}
				break;
			default:
				output.write(`Error: Unknown simulation type. Use "healthy", "unhealthy", "memory-high", "memory-normal", or "error"\n`);
				return;
		}

		// Update metadata with operation details
		this.updateMetadata('lastOperation', 'simulateStatus');
		this.updateMetadata('lastSimulation', status);
	}

	/**
	 * Update service metadata in a type-safe way
	 */
	private updateMetadata(key: string, value: unknown): void {
		// This method would normally interact with the service registry
		// For demonstration, we'll just record these values in memory
		// In a real implementation, you would update the ServiceState.metadata
	}
}

// Export default service instance
export const examplesService = new ExamplesService();
