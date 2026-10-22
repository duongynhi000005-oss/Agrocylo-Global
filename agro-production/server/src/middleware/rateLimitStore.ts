/**
 * Shared rate-limit store interface.
 *
 * Plug in Redis (`ioredis`) for multi-instance deployments:
 *
 *   REDIS_URL=redis://localhost:6379
 *
 * Without REDIS_URL the store falls back to an in-memory Map
 * (suitable for single-instance / development).
 */

interface StoreEntry {
  count: number;
  resetAt: number;
}

const memoryStore = new Map<string, StoreEntry>();

export function createRateLimitStore(): {
  increment(
    key: string,
    windowMs: number,
  ): Promise<{ count: number; resetAt: Date }>;
} {
  return {
    async increment(key: string, windowMs: number) {
      const now = Date.now();
      const entry = memoryStore.get(key);
      if (!entry || now >= entry.resetAt) {
        const resetAt = now + windowMs;
        memoryStore.set(key, { count: 1, resetAt });
        return { count: 1, resetAt: new Date(resetAt) };
      }
      entry.count += 1;
      return { count: entry.count, resetAt: new Date(entry.resetAt) };
    },
  };
}

export { createRateLimitStore as createSharedRateLimitStore };
