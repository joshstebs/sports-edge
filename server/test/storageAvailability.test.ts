import assert from 'node:assert/strict';
import test from 'node:test';
import { storageStatus } from '../src/lib/predictionStore.js';

const KEYS = ['VERCEL', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'] as const;

function withEnv(values: Partial<Record<(typeof KEYS)[number], string | undefined>>, fn: () => void) {
  const saved = KEYS.map((key) => process.env[key]);
  for (const key of KEYS) {
    const next = values[key];
    if (next === undefined) delete process.env[key];
    else process.env[key] = next;
  }
  try {
    fn();
  } finally {
    KEYS.forEach((key, index) => {
      if (saved[index] === undefined) delete process.env[key];
      else process.env[key] = saved[index];
    });
  }
}

test('a Vercel preview without Upstash fails closed as not configured', () => {
  withEnv({ VERCEL: '1', UPSTASH_REDIS_REST_URL: undefined, UPSTASH_REDIS_REST_TOKEN: undefined }, () => {
    assert.deepEqual(storageStatus(), { backend: 'not-configured', durable: false });
  });
});

test('isolated preview storage is durable when Upstash is configured', () => {
  withEnv({
    VERCEL: '1',
    UPSTASH_REDIS_REST_URL: 'https://preview-redis.example.invalid',
    UPSTASH_REDIS_REST_TOKEN: 'preview-token',
  }, () => {
    assert.deepEqual(storageStatus(), { backend: 'upstash-redis', durable: true });
  });
});
