# Service State Management Implementation

## Overview
The service state management system provides a way to track, monitor, and manage the runtime state of services in the shell environment. It is implemented primarily in the ServiceRegistry class.

## Core Components

### 1. Service State Interface
```typescript
interface ServiceState {
  status: ServiceStatus;
  health: {
    lastCheck: Date;
    errors: string[];
  };
  metadata: Record<string, unknown>;
}
```

### 2. Service Status Enumeration
```typescript
enum ServiceStatus {
  INITIALIZING = "initializing",
  RUNNING = "running",
  DEGRADED = "degraded",
  ERROR = "error",
  STOPPED = "stopped"
}
```

## Implementation Details

### 1. State Storage
- Each service has an associated state object stored in the ServiceRegistry
- States are maintained in a private Map: `private states: Map<string, ServiceState>`
- Service states persist for the lifetime of the service registration

### 2. State Management Functions

#### State Updates
```typescript
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
```

#### Health Monitoring
```typescript
async checkServiceHealth(name: string): Promise<boolean> {
  const service = this.services.get(name);
  const state = this.states.get(name);
  
  if (service?.healthCheck && state) {
    try {
      const healthy = await service.healthCheck();
      this.updateServiceStatus(
        name, 
        healthy ? ServiceStatus.RUNNING : ServiceStatus.DEGRADED
      );
      return healthy;
    } catch (error) {
      this.updateServiceStatus(name, ServiceStatus.ERROR, error.message);
      return false;
    }
  }
  return false;
}
```

### 3. Lifecycle Integration

#### Service Registration
1. State Initialization
```typescript
this.states.set(name, {
  status: ServiceStatus.INITIALIZING,
  health: { lastCheck: new Date(), errors: [] },
  metadata: {}
});
```

2. Initial Health Check
```typescript
if (config.healthCheck) {
  try {
    await config.healthCheck();
    this.updateServiceStatus(name, ServiceStatus.RUNNING);
  } catch (error) {
    this.updateServiceStatus(name, ServiceStatus.ERROR);
    throw error;
  }
}
```

#### Service Cleanup
```typescript
async unregisterService(name: string): Promise<void> {
  this.updateServiceStatus(name, ServiceStatus.STOPPED);
  const service = this.services.get(name);
  if (service?.cleanup) {
    await service.cleanup();
  }
  this.services.delete(name);
  this.states.delete(name);
}
```

## Example Service Implementation

### File System Service
```typescript
class FileSystemService {
  private async checkHealth(): Promise<boolean> {
    try {
      await Deno.stat(this.path);
      return true;
    } catch {
      return false;
    }
  }
}
```

### Process Service
```typescript
class ProcessService {
  private async checkHealth(): Promise<boolean> {
    try {
      Deno.pid;
      return true;
    } catch {
      return false;
    }
  }
}
```

## State Monitoring

### Active Monitoring
- Regular health checks through service health check functions
- Status updates on every operation
- Error tracking and accumulation

### Passive Monitoring
- State queries through `getServiceState`
- Health status through `checkServiceHealth`
- Error history in state object

## Error Handling

### Error Recording
- Errors are stored in the health.errors array
- Each error includes timestamp through lastCheck
- Errors persist until service cleanup

### Status Updates
- Status changes based on operation outcomes
- Automatic degradation on repeated errors
- Recovery tracking through health checks

## Benefits

1. **Operational Awareness**
   - Real-time service status tracking
   - Health monitoring integration
   - Error history preservation

2. **Service Lifecycle Management**
   - Clear state transitions
   - Cleanup coordination
   - Resource management

3. **Debugging Support**
   - Error history tracking
   - State transition logging
   - Health check results

4. **Recovery Management**
   - State-aware operations
   - Automatic status updates
   - Error-driven recovery

## Usage Examples

### Health Monitoring
```typescript
// Check service health
const healthy = await serviceRegistry.checkServiceHealth("fs");
if (!healthy) {
  const state = serviceRegistry.getServiceState("fs");
  console.log(`Service errors: ${state.health.errors.join(", ")}`);
}
```

### Status Management
```typescript
// Update service status
serviceRegistry.updateServiceStatus(
  "process",
  ServiceStatus.DEGRADED,
  "High CPU usage"
);
```

### State Querying
```typescript
// Get service state
const state = serviceRegistry.getServiceState("fs");
if (state.status === ServiceStatus.ERROR) {
  console.log(`Last error: ${state.health.errors.at(-1)}`);
}