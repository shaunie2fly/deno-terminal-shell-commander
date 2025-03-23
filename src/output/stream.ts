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
type StreamEventType = "data" | "end" | "error";

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
    this.notifyListeners("data", transformed);
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
    if (!this.eventListeners.has("data")) {
      this.eventListeners.set("data", new Set());
    }
    this.eventListeners.get("data")?.add(callback);
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
    this.notifyListeners("end", "");
  }

  /**
   * Notify listeners of stream events
   */
  private notifyListeners(type: StreamEventType, data: string): void {
    this.eventListeners.get(type)?.forEach(listener => {
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