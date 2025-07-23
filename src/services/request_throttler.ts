
// src/services/request_throttler.ts

interface QueuedRequest<T> {
  resolve: (value: T) => void;
  reject: (reason?: any) => void;
  task: () => Promise<T>;
}

class RequestThrottler<T> {
  private queue: QueuedRequest<T>[] = [];
  private runningRequests: number = 0;
  private maxConcurrentRequests: number;
  private intervalMs: number;
  private lastExecutionTime: number = 0;

  constructor(maxConcurrentRequests: number, intervalMs: number) {
    this.maxConcurrentRequests = maxConcurrentRequests;
    this.intervalMs = intervalMs;
  }

  public async addRequest(task: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push({ resolve, reject, task });
      this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this.runningRequests >= this.maxConcurrentRequests || this.queue.length === 0) {
      return;
    }

    const now = Date.now();
    const timeSinceLastExecution = now - this.lastExecutionTime;

    if (timeSinceLastExecution < this.intervalMs) {
      setTimeout(() => this.processQueue(), this.intervalMs - timeSinceLastExecution);
      return;
    }

    this.runningRequests++;
    this.lastExecutionTime = now;

    const nextRequest = this.queue.shift();
    if (nextRequest) {
      try {
        const result = await nextRequest.task();
        nextRequest.resolve(result);
      } catch (error) {
        nextRequest.reject(error);
      } finally {
        this.runningRequests--;
        this.processQueue();
      }
    }
  }
}

export { RequestThrottler };
