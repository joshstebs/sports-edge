import { createHash } from 'node:crypto';
import type { RequestHandler } from 'express';

interface RateLimitOptions {
  scope: string;
  windowMs: number;
  limit: number;
}

interface RateState { count: number; resetAt: number }
const localBuckets = new Map<string, RateState>();
let warnedAboutRedis = false;

function safeScope(value: string): string {
  if (!/^[a-z0-9_-]{1,40}$/i.test(value)) throw new Error('Invalid rate-limit scope.');
  return value;
}

function bucketKey(scope: string, userId: string, resetAt: number): string {
  const identity = createHash('sha256').update(userId).digest('hex').slice(0, 32);
  const prefix = process.env.SPORTS_EDGE_REDIS_PREFIX || 'sports-edge';
  return `${prefix}:rate:${scope}:${identity}:${resetAt}`;
}

function localIncrement(key: string, resetAt: number): RateState {
  const current = localBuckets.get(key);
  const state = current && current.resetAt > Date.now()
    ? { count: current.count + 1, resetAt: current.resetAt }
    : { count: 1, resetAt };
  localBuckets.set(key, state);
  if (localBuckets.size > 10_000) {
    const now = Date.now();
    for (const [candidate, value] of localBuckets) if (value.resetAt <= now) localBuckets.delete(candidate);
  }
  return state;
}

async function redisIncrement(key: string, windowMs: number, resetAt: number): Promise<RateState | null> {
  const base = process.env.UPSTASH_REDIS_REST_URL?.replace(/\/$/, '');
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!base || !token) return null;
  const script = "local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('PEXPIRE',KEYS[1],ARGV[1]) end; return n";
  try {
    const response = await fetch(base, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(['EVAL', script, 1, key, windowMs]),
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json() as { result?: number; error?: string };
    if (payload.error || !Number.isFinite(payload.result)) throw new Error(payload.error || 'invalid response');
    return { count: Number(payload.result), resetAt };
  } catch (error) {
    if (!warnedAboutRedis) {
      warnedAboutRedis = true;
      console.error('[rate limit] Redis unavailable; using per-instance fallback:', error instanceof Error ? error.message : error);
    }
    return null;
  }
}

/** Durable per-account fixed-window protection with a local development fallback. */
export function createUserRateLimiter(options: RateLimitOptions): RequestHandler {
  const scope = safeScope(options.scope);
  if (!Number.isInteger(options.limit) || options.limit < 1 || !Number.isInteger(options.windowMs) || options.windowMs < 1_000) {
    throw new Error('Invalid rate-limit options.');
  }
  return async (req, res, next) => {
    if (!req.auth) {
      res.status(401).json({ ok: false, error: 'Authentication required.' });
      return;
    }
    const resetAt = Math.floor(Date.now() / options.windowMs) * options.windowMs + options.windowMs;
    const key = bucketKey(scope, req.auth.userId, resetAt);
    const state = await redisIncrement(key, options.windowMs, resetAt) ?? localIncrement(key, resetAt);
    const remaining = Math.max(0, options.limit - state.count);
    res.setHeader('RateLimit-Limit', String(options.limit));
    res.setHeader('RateLimit-Remaining', String(remaining));
    res.setHeader('RateLimit-Reset', String(Math.ceil(state.resetAt / 1_000)));
    if (state.count > options.limit) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((state.resetAt - Date.now()) / 1_000))));
      res.status(429).json({ ok: false, error: 'Account rate limit reached. Try again later.' });
      return;
    }
    next();
  };
}
