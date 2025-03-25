/**
 * Output stream options
 */
export interface StreamOptions {
	buffered: boolean;
	maxBuffer?: number;
	formatted: boolean;
}

/**
 * Output transformer interface
 */
export interface OutputTransformer {
	transform(data: string): string;
}

/**
 * Output stream event types
 */
type StreamEventType = 'data' | 'end' | 'error';

/**
 * Output stream event listener
 */
type StreamEventListener = (data: string) => void;

/**
 * Output stream implementation
 */
export class OutputStream {
	private buffer: string[];
	private transformers: OutputTransformer[];
	private eventListeners: Map<StreamEventType, Set<StreamEventListener>>;
	private options: StreamOptions;

	constructor(options: StreamOptions) {
		this.buffer = [];
		this.transformers = [];
		this.eventListeners = new Map();
		this.options = options;
	}

	/**
	 * Write data to the stream
	 */
	write(data: string): void {
		// Apply transformers
		let transformed = data;
		for (const transformer of this.transformers) {
			transformed = transformer.transform(transformed);
		}

		// Handle buffering
		if (this.options.buffered) {
			this.buffer.push(transformed);
			if (this.options.maxBuffer && this.buffer.length > this.options.maxBuffer) {
				this.buffer.shift();
			}
		}

		// Notify listeners
		this.notifyListeners('data', transformed);
	}

	/**
	 * Add transformer to the stream
	 */
	pipe(transformer: OutputTransformer): OutputStream {
		this.transformers.push(transformer);
		return this;
	}

	/**
	 * Add event listener
	 */
	onData(callback: StreamEventListener): void {
		if (!this.eventListeners.has('data')) {
			this.eventListeners.set('data', new Set());
		}
		this.eventListeners.get('data')?.add(callback);
	}

	/**
	 * Remove event listener
	 */
	removeListener(type: StreamEventType, callback: StreamEventListener): void {
		this.eventListeners.get(type)?.delete(callback);
	}

	/**
	 * Get buffer contents
	 */
	getBuffer(): string[] {
		return [...this.buffer];
	}

	/**
	 * Clear buffer
	 */
	clearBuffer(): void {
		this.buffer = [];
	}

	/**
	 * End the stream
	 */
	end(): void {
		this.notifyListeners('end', '');
	}

	/**
	 * Notify listeners of stream events
	 */
	private notifyListeners(type: StreamEventType, data: string): void {
		this.eventListeners.get(type)?.forEach((listener) => {
			listener(data);
		});
	}
}

/**
 * Output manager for handling multiple streams
 */
export class OutputManager {
	private streams: Map<string, OutputStream>;

	constructor() {
		this.streams = new Map();
	}

	/**
	 * Create a new output stream
	 */
	createStream(options: StreamOptions): OutputStream {
		const stream = new OutputStream(options);
		return stream;
	}

	/**
	 * Attach stream to a target
	 */
	attach(stream: OutputStream, target: string): void {
		this.streams.set(target, stream);
	}

	/**
	 * Detach stream from target
	 */
	detach(stream: OutputStream): void {
		for (const [target, str] of this.streams.entries()) {
			if (str === stream) {
				this.streams.delete(target);
				break;
			}
		}
	}

	/**
	 * Get stream by target
	 */
	getStream(target: string): OutputStream | undefined {
		return this.streams.get(target);
	}
}

// Export default output manager instance
export const outputManager = new OutputManager();

/**
 * Output Stream Implementation
 *
 * Provides utilities for streaming and transforming shell output
 * @module
 */

/**
 * Options for creating an output stream
 */
export interface OutputStreamOptions {
	/** Buffer size for the stream (default: 10240) */
	bufferSize?: number;
	/** Whether to capture ANSI color codes (default: true) */
	captureColorCodes?: boolean;
	/** Whether to capture line breaks (default: true) */
	captureLineBreaks?: boolean;
}

/**
 * Creates a transform stream for shell output
 * @param options - Configuration options for the stream
 * @returns A transform stream that can process shell output
 */
export function createOutputStream(options: OutputStreamOptions = {}): TransformStream<string, string> {
	// Set default options
	const opts = {
		bufferSize: options.bufferSize ?? 10240,
		captureColorCodes: options.captureColorCodes ?? true,
		captureLineBreaks: options.captureLineBreaks ?? true,
	};

	// Create a transform stream
	return new TransformStream({
		transform(chunk: string, controller) {
			// Process the chunk based on options
			let processedChunk = chunk;

			// Strip ANSI color codes if not capturing them
			if (!opts.captureColorCodes) {
				processedChunk = processedChunk.replace(/\x1b\[\d+m/g, '');
			}

			// Handle line breaks
			if (!opts.captureLineBreaks) {
				processedChunk = processedChunk.replace(/\r\n|\r|\n/g, ' ');
			}

			// Add the processed chunk to the output stream
			controller.enqueue(processedChunk);
		},
	});
}

/**
 * Pipe an output stream through multiple transformers
 * @param stream - The input stream
 * @param transformers - Array of transformer functions to apply
 * @returns A transformed stream
 */
export function pipeOutputTransformers(
	stream: ReadableStream<string>,
	transformers: Array<TransformStream<string, string>>,
): ReadableStream<string> {
	// Apply each transformer in sequence
	let result = stream;
	for (const transformer of transformers) {
		result = result.pipeThrough(transformer);
	}
	return result;
}

/**
 * Create a stream from a string or array of strings
 * @param content - String or array of strings to stream
 * @returns A readable stream of the content
 */
export function createStringStream(content: string | string[]): ReadableStream<string> {
	const contentArray = Array.isArray(content) ? content : [content];
	let index = 0;

	return new ReadableStream({
		pull(controller) {
			if (index < contentArray.length) {
				controller.enqueue(contentArray[index++]);
			} else {
				controller.close();
			}
		},
	});
}

/**
 * Read a stream into a string
 * @param stream - The stream to read
 * @returns Promise resolving to the stream contents as a string
 */
export async function streamToString(stream: ReadableStream<string>): Promise<string> {
	const reader = stream.getReader();
	let result = '';

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			result += value;
		}
		return result;
	} finally {
		reader.releaseLock();
	}
}
