
// src/services/response_cache.ts

interface CacheEntry<T> {
  value: T;
  timestamp: number;
  ttl: number; // Time to live in milliseconds
}

class ResponseCache<T> {
  private cache: Map<string, CacheEntry<T>> = new Map();

  public set(key: string, value: T, ttl: number): void {
    const timestamp = Date.now();
    this.cache.set(key, { value, timestamp, ttl });
  }

  public get(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      return undefined;
    }

    const now = Date.now();
    if (now - entry.timestamp > entry.ttl) {
      this.cache.delete(key); // Invalidate expired entry
      return undefined;
    }

    return entry.value;
  }

  public delete(key: string): void {
    this.cache.delete(key);
  }

  public clear(): void {
    this.cache.clear();
  }
}

export { ResponseCache };
