import { Redis } from '@upstash/redis';

class RedisService {
  private client: Redis | null = null;
  private isConfigured: boolean = false;

  constructor() {
    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;

    if (url && token) {
      try {
        this.client = new Redis({
          url,
          token,
        });
        this.isConfigured = true;
        console.log('[Redis] Upstash Redis client initialized successfully.');
      } catch (error: any) {
        console.error('[Redis] Failed to initialize Upstash Redis:', error.message);
      }
    } else {
      console.warn('[Redis] Missing UPSTASH_REDIS_REST_URL or UPSTASH_REDIS_REST_TOKEN. Running without Redis.');
    }
  }

  /**
   * Set a cache value with an optional TTL (Time To Live) in seconds.
   */
  async set(key: string, value: any, ttlSeconds?: number): Promise<void> {
    if (!this.isConfigured || !this.client) return;

    try {
      if (ttlSeconds) {
        await this.client.set(key, JSON.stringify(value), { ex: ttlSeconds });
      } else {
        await this.client.set(key, JSON.stringify(value));
      }
    } catch (error: any) {
      console.warn(`[Redis] Failed to set cache key "${key}":`, error.message);
    }
  }

  /**
   * Get a cache value by key.
   */
  async get<T>(key: string): Promise<T | null> {
    if (!this.isConfigured || !this.client) return null;

    try {
      const data = await this.client.get(key);
      if (data !== null && data !== undefined) {
        return (typeof data === 'string' ? JSON.parse(data) : data) as T;
      }
      return null;
    } catch (error: any) {
      console.warn(`[Redis] Failed to get cache key "${key}":`, error.message);
      return null;
    }
  }

  /**
   * Delete a cache key.
   */
  async del(key: string): Promise<void> {
    if (!this.isConfigured || !this.client) return;

    try {
      await this.client.del(key);
    } catch (error: any) {
      console.warn(`[Redis] Failed to delete cache key "${key}":`, error.message);
    }
  }

  /**
   * Increment a key (useful for rate limiting).
   * Automatically sets a TTL if it's the first time the key is created.
   */
  async incrementWithTTL(key: string, ttlSeconds: number): Promise<number> {
    if (!this.isConfigured || !this.client) return -1; // -1 means Redis not available

    try {
      const pipeline = this.client.pipeline();
      pipeline.incr(key);
      pipeline.expire(key, ttlSeconds);
      const results = await pipeline.exec();
      
      // results[0] is the result of incr
      return results[0] as number;
    } catch (error: any) {
      console.warn(`[Redis] Failed to increment key "${key}":`, error.message);
      return -1;
    }
  }
}

export default new RedisService();
