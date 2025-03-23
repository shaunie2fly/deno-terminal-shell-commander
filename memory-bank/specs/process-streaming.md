# Process Status Streaming Specification

## Overview
This document outlines the pattern for streaming status updates from async processes to the terminal shell's output system.

## Implementation Pattern

### 1. Stream Setup
```typescript
// Create a buffered stream for the process
const processStream = outputManager.createStream({
  buffered: true,
  maxBuffer: 1000,
  formatted: true
});

// Attach to a specific target (e.g., process ID or name)
outputManager.attach(processStream, `process-${processId}`);
```

### 2. Process Integration
```typescript
async function runAsyncProcess() {
  const stream = outputManager.getStream(`process-${processId}`);
  
  try {
    // Stream status updates
    stream.write("Process starting...");
    
    // Report progress
    for (const step of processSteps) {
      await step();
      stream.write(`Completed: ${step.name}`);
    }
    
    stream.write("Process completed successfully");
  } catch (error) {
    stream.write(`Error: ${error.message}`);
  } finally {
    stream.end();
  }
}
```

### 3. Status Formatting
Use output transformers to format status updates:
```typescript
interface ProcessStatusTransformer extends OutputTransformer {
  transform(data: string): string {
    return `[${new Date().toISOString()}] ${data}`;
  }
}

processStream.pipe(new ProcessStatusTransformer());
```

## Best Practices

1. **Structured Updates**
   - Use consistent status message formats
   - Include timestamps
   - Clearly indicate process state changes
   - Report progress percentages when available

2. **Error Handling**
   - Stream error messages immediately
   - Include error context and stack traces
   - Indicate if process can continue or needs restart

3. **Resource Management**
   - Always call stream.end() when process completes
   - Detach streams for completed processes
   - Clean up event listeners

4. **Performance Considerations**
   - Use buffering for high-frequency updates
   - Set appropriate buffer size limits
   - Consider update throttling for intensive processes

## Example Usage

### Basic Status Streaming
```typescript
async function compileProject() {
  const stream = outputManager.createStream({
    buffered: true,
    maxBuffer: 100,
    formatted: true
  });
  
  outputManager.attach(stream, 'compile-status');
  
  try {
    stream.write("Starting compilation...");
    
    // Compilation steps
    stream.write("Parsing source files...");
    await parseFiles();
    
    stream.write("Generating output...");
    await generate();
    
    stream.write("Compilation complete");
  } catch (error) {
    stream.write(`Compilation failed: ${error.message}`);
  } finally {
    stream.end();
    outputManager.detach(stream);
  }
}
```

### Progress Reporting
```typescript
interface ProgressUpdate {
  percent: number;
  status: string;
}

async function longRunningTask() {
  const stream = outputManager.createStream({
    buffered: true,
    formatted: true
  });
  
  // Update progress every 5%
  for (let i = 0; i <= 100; i += 5) {
    stream.write(JSON.stringify({
      percent: i,
      status: `Processing: ${i}% complete`
    }));
    await someWork();
  }
}
```

## Stream Options Guide

1. **Buffered Mode**
   - Enable for high-frequency updates
   - Set maxBuffer based on memory constraints
   - Useful for log-style output

2. **Formatted Mode**
   - Enable for structured data
   - Use with transformers for consistent formatting
   - Helpful for machine-readable output

3. **Direct Mode**
   - Use for immediate, low-frequency updates
   - Better for real-time status display
   - Minimal memory overhead

## Integration with Shell UI

1. Connect process streams to UI components:
```typescript
const stream = outputManager.getStream('process-id');
stream.onData((data) => {
  updateUIComponent(data);
});
```

2. Handle stream lifecycle:
```typescript
stream.onData((data) => {
  // Update UI
});

// Cleanup
stream.removeListener('data', updateUIComponent);
```

## Next Steps

1. Implement standard process status transformers
2. Create helper functions for common streaming patterns
3. Add support for stream filtering and aggregation
4. Develop UI components for status visualization