import assert from 'node:assert/strict';
import test from 'node:test';
import { pacedFetch } from '../src/providers/http.js';

test('pacedFetch reserves serialized network start slots', async () => {
  const originalFetch = globalThis.fetch;
  const starts: number[] = [];
  globalThis.fetch = (async () => {
    starts.push(Date.now());
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  try {
    await Promise.all([
      pacedFetch('https://provider.test/1', {}, 30),
      pacedFetch('https://provider.test/2', {}, 30),
      pacedFetch('https://provider.test/3', {}, 30),
    ]);
    assert.equal(starts.length, 3);
    assert(starts[1] - starts[0] >= 20, `first gap was ${starts[1] - starts[0]}ms`);
    assert(starts[2] - starts[1] >= 20, `second gap was ${starts[2] - starts[1]}ms`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
