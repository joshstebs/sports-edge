import assert from 'node:assert/strict';
import test from 'node:test';
import { parseFrame } from '../src/lib/sse.ts';
import type { ChatEvent } from '../src/types.ts';

test('SSE parser accepts CRLF frames and repeated SGP events', () => {
  const events: ChatEvent[] = [];
  parseFrame('event: sgp\r\ndata: {"legs":[{"selection":"A"}]}\r\n', (event) => events.push(event));
  parseFrame('event: sgp\ndata: {"legs":[{"selection":"B"}]}\n', (event) => events.push(event));
  assert.equal(events.length, 2);
  assert.deepEqual(events.map((event) => event.type), ['sgp', 'sgp']);
});

test('SSE parser joins data lines and ignores malformed JSON', () => {
  const events: ChatEvent[] = [];
  parseFrame('event: delta\ndata: {"text":\ndata: "hello"}', (event) => events.push(event));
  parseFrame('event: delta\ndata: not-json', (event) => events.push(event));
  assert.deepEqual(events, [{ type: 'delta', text: 'hello' }]);
});

