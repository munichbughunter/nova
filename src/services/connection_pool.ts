
// src/services/connection_pool.ts

interface Connection {
  id: number;
  // Add other connection-specific properties here
}

class ConnectionPool {
  private connections: Connection[] = [];
  private availableConnections: Connection[] = [];
  private maxConnections: number;
  private connectionIdCounter: number = 0;

  constructor(maxConnections: number) {
    this.maxConnections = maxConnections;
  }

  public async getConnection(): Promise<Connection> {
    if (this.availableConnections.length > 0) {
      return this.availableConnections.pop()!;
    }

    if (this.connections.length < this.maxConnections) {
      const newConnection = await this.createConnection();
      this.connections.push(newConnection);
      return newConnection;
    }

    // If no available connections and max connections reached, wait for one to be released
    return new Promise((resolve) => {
      // In a real-world scenario, you'd use a queue or event emitter here
      // to notify when a connection becomes available. For simplicity,
      // this example just waits.
      const interval = setInterval(() => {
        if (this.availableConnections.length > 0) {
          clearInterval(interval);
          resolve(this.availableConnections.pop()!);
        }
      }, 100);
    });
  }

  public releaseConnection(connection: Connection): void {
    this.availableConnections.push(connection);
  }

  private async createConnection(): Promise<Connection> {
    // Simulate asynchronous connection creation
    return new Promise((resolve) => {
      setTimeout(() => {
        this.connectionIdCounter++;
        console.log(`Creating new connection: ${this.connectionIdCounter}`);
        resolve({ id: this.connectionIdCounter });
      }, 50);
    });
  }
}

export { ConnectionPool };
export type { Connection };
