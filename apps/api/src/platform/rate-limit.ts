/** In-process token bucket (ADR-015). Single instance only; daily quotas live in the database. */
export interface BucketConfig {
  capacity: number;
  refillPerSecond: number;
}

interface BucketState {
  tokens: number;
  updatedMs: number;
}

export class RateLimiter {
  private readonly buckets = new Map<string, BucketState>();

  constructor(
    private readonly config: BucketConfig,
    private readonly maxKeys = 50_000,
  ) {}

  /** Try to consume one token. Returns whether it was allowed and, if not, seconds to wait. */
  take(
    key: string,
    nowMs: number,
  ): { allowed: boolean; retryAfterSeconds: number; remaining: number } {
    let b = this.buckets.get(key);
    if (!b) {
      if (this.buckets.size >= this.maxKeys) this.evictOldest();
      b = { tokens: this.config.capacity, updatedMs: nowMs };
      this.buckets.set(key, b);
    }
    const elapsed = Math.max(0, nowMs - b.updatedMs) / 1000;
    b.tokens = Math.min(this.config.capacity, b.tokens + elapsed * this.config.refillPerSecond);
    b.updatedMs = nowMs;
    if (b.tokens >= 1) {
      b.tokens -= 1;
      return { allowed: true, retryAfterSeconds: 0, remaining: Math.floor(b.tokens) };
    }
    const retryAfterSeconds = Math.ceil((1 - b.tokens) / this.config.refillPerSecond);
    return { allowed: false, retryAfterSeconds, remaining: 0 };
  }

  private evictOldest(): void {
    let oldestKey: string | undefined;
    let oldest = Infinity;
    for (const [k, v] of this.buckets) {
      if (v.updatedMs < oldest) {
        oldest = v.updatedMs;
        oldestKey = k;
      }
    }
    if (oldestKey) this.buckets.delete(oldestKey);
  }
}

/** Default limits from plan section 12.1 (per minute figures converted to bucket parameters). */
export const LIMITS = {
  publicGet: { capacity: 120, refillPerSecond: 120 / 60 },
  search: { capacity: 30, refillPerSecond: 30 / 60 },
  login: { capacity: 10, refillPerSecond: 10 / (15 * 60) },
  register: { capacity: 5, refillPerSecond: 5 / 3600 },
  authedWrite: { capacity: 60, refillPerSecond: 60 / 60 },
} satisfies Record<string, BucketConfig>;
