class SafetyManager {
  constructor() {
    this.activeRequests = 0;
    this.queue = [];
    this.isShuttingDown = false;
    this.maxConcurrent = parseInt(process.env.MAX_CONCURRENT_REQUESTS) || 5;
    this.maxRequestTime = parseInt(process.env.MAX_REQUEST_TIME) || 25000;
  }

  async processWithTimeout(operation, operationName, timeoutMs = null) {
    if (this.isShuttingDown) {
      throw new Error('System is shutting down');
    }

    if (this.activeRequests >= this.maxConcurrent) {
      return new Promise((resolve, reject) => {
        this.queue.push({ resolve, reject });
      }).then(() => this.processWithTimeout(operation, operationName, timeoutMs));
    }

    this.activeRequests++;
    const actualTimeout = timeoutMs || this.maxRequestTime;

    return new Promise(async (resolve, reject) => {
      const timeoutId = setTimeout(() => {
        console.error(`⏰ TIMEOUT: ${operationName} (${actualTimeout}ms)`);
        reject(new Error(`Operation timed out after ${actualTimeout}ms`));
        this.activeRequests--;
        
        const index = this.queue.findIndex(req => req.resolve === resolve);
        if (index > -1) {
          this.queue.splice(index, 1);
        }
      }, actualTimeout);

      try {
        const result = await operation();
        clearTimeout(timeoutId);
        resolve(result);
      } catch (error) {
        clearTimeout(timeoutId);
        reject(error);
      } finally {
        this.activeRequests--;
        
        if (this.queue.length > 0) {
          const nextRequest = this.queue.shift();
          nextRequest.resolve();
        }
      }
    });
  }

  initiateShutdown() {
    this.isShuttingDown = true;
    
    while (this.queue.length > 0) {
      const { reject } = this.queue.shift();
      reject(new Error('System is shutting down'));
    }
    
    console.log(`Shutdown initiated. Active requests: ${this.activeRequests}`);
  }

  getStats() {
    return {
      activeRequests: this.activeRequests,
      queueSize: this.queue.length,
      isShuttingDown: this.isShuttingDown,
      maxConcurrent: this.maxConcurrent
    };
  }
}

module.exports = SafetyManager;