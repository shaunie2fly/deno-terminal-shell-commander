# Service State Management Examples

## Command Implementation Examples

### 1. Service Registration and Initialization

```typescript
// Register File System Service
registry.registerService("fs", new FileSystemService("/path/to/watch"), {
  healthCheck: true,
  autoStart: true
});

// Register Process Monitor Service
registry.registerService("process", new ProcessService(), {
  healthCheck: true,
  autoStart: false
});
```

### 2. Health Check Commands

```typescript
// Check health of all services
async function checkAllServicesHealth() {
  const services = registry.getRegisteredServices();
  for (const name of services) {
    const healthy = await registry.checkServiceHealth(name);
    const state = registry.getServiceState(name);
    console.log(`Service ${name}: ${healthy ? "HEALTHY" : "UNHEALTHY"}`);
    if (!healthy) {
      console.log(`Last error: ${state.health.errors.at(-1)}`);
    }
  }
}

// Monitor specific service health
async function monitorServiceHealth(name: string, interval: number) {
  setInterval(async () => {
    const healthy = await registry.checkServiceHealth(name);
    const state = registry.getServiceState(name);
    if (!healthy) {
      console.log(`Service ${name} health check failed`);
      console.log(`Current status: ${state.status}`);
      console.log(`Errors: ${state.health.errors.join(", ")}`);
    }
  }, interval);
}
```

### 3. State Management Commands

```typescript
// Get detailed service state report
function getServiceReport(name: string) {
  const state = registry.getServiceState(name);
  return {
    status: state.status,
    lastCheck: state.health.lastCheck,
    errorCount: state.health.errors.length,
    lastError: state.health.errors.at(-1),
    metadata: state.metadata
  };
}

// Update service metadata
function updateServiceMetadata(name: string, metadata: Record<string, unknown>) {
  const state = registry.getServiceState(name);
  state.metadata = { ...state.metadata, ...metadata };
}
```

### 4. Error Recovery Commands

```typescript
// Attempt service recovery
async function recoverService(name: string) {
  const state = registry.getServiceState(name);
  if (state.status === ServiceStatus.ERROR || state.status === ServiceStatus.DEGRADED) {
    // Stop the service
    await registry.unregisterService(name);
    
    // Wait for cleanup
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Re-register with fresh state
    try {
      await registry.registerService(name, new FileSystemService(), {
        healthCheck: true,
        autoStart: true
      });
      console.log(`Service ${name} recovered successfully`);
    } catch (error) {
      console.error(`Failed to recover service ${name}: ${error.message}`);
    }
  }
}
```

### 5. Lifecycle Management Commands

```typescript
// Graceful shutdown of all services
async function shutdownAllServices() {
  const services = registry.getRegisteredServices();
  for (const name of services) {
    try {
      await registry.unregisterService(name);
      console.log(`Service ${name} stopped successfully`);
    } catch (error) {
      console.error(`Error stopping service ${name}: ${error.message}`);
    }
  }
}

// Service restart with state preservation
async function restartService(name: string) {
  const state = registry.getServiceState(name);
  const metadata = { ...state.metadata };
  
  await registry.unregisterService(name);
  
  // Preserve metadata during restart
  const service = new FileSystemService();
  await registry.registerService(name, service, {
    healthCheck: true,
    autoStart: true
  });
  
  const newState = registry.getServiceState(name);
  newState.metadata = metadata;
}
```

## Usage Patterns

### 1. Regular Health Monitoring
```typescript
// Monitor all critical services every 5 minutes
const CRITICAL_SERVICES = ["fs", "process"];
CRITICAL_SERVICES.forEach(service => {
  monitorServiceHealth(service, 5 * 60 * 1000);
});
```

### 2. Error-Driven Recovery
```typescript
// Implement automatic recovery for degraded services
function setupAutoRecovery() {
  setInterval(async () => {
    const services = registry.getRegisteredServices();
    for (const name of services) {
      const state = registry.getServiceState(name);
      if (state.status === ServiceStatus.DEGRADED) {
        await recoverService(name);
      }
    }
  }, 15 * 60 * 1000); // Check every 15 minutes
}
```

### 3. State-Based Operations
```typescript
// Execute operation only if service is healthy
async function executeIfHealthy(name: string, operation: () => Promise<void>) {
  const state = registry.getServiceState(name);
  if (state.status === ServiceStatus.RUNNING) {
    await operation();
  } else {
    throw new Error(`Service ${name} is not healthy (Status: ${state.status})`);
  }
}
```

## Best Practices

1. **Regular Health Checks**
   - Implement automated health monitoring
   - Set appropriate check intervals based on service criticality
   - Log health check results for trend analysis

2. **Error Management**
   - Implement automatic recovery for non-critical errors
   - Preserve error history for debugging
   - Set up alerts for repeated errors

3. **State Transitions**
   - Log all state transitions
   - Implement graceful degradation
   - Preserve metadata during restarts

4. **Resource Management**
   - Clean up resources during service shutdown
   - Monitor resource usage in metadata
   - Implement resource-based health checks