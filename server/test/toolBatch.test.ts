import assert from 'node:assert/strict';
import test from 'node:test';
import { evidenceForExecution, executeToolBatch } from '../src/llm/toolBatch.js';
import type { ToolExecution } from '../src/llm/toolRegistry.js';

test('evidenceForExecution records sources, freshness and availability', () => {
  const outcome: ToolExecution = {
    ok: true,
    summary: 'fetched odds',
    data: { source: 'api.the-odds-api.com', nested: { source: 'site.web.api.espn.com' } },
    json: JSON.stringify({ available: true, source: 'api.the-odds-api.com' }),
  };
  const evidence = evidenceForExecution(outcome, 42, new Date('2026-08-17T00:00:00.000Z'));
  assert.deepEqual(evidence, {
    sources: ['api.the-odds-api.com', 'site.web.api.espn.com'],
    fetchedAt: '2026-08-17T00:00:00.000Z',
    latencyMs: 42,
    quality: 'verified-live',
  });
});

test('executeToolBatch runs one model turn in parallel and preserves call order', async () => {
  let active = 0;
  let maxActive = 0;
  const executor = async (name: string): Promise<ToolExecution> => {
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, name === 'slow' ? 25 : 10));
    active--;
    return {
      ok: true,
      summary: `done ${name}`,
      data: { source: `${name}.example` },
      json: JSON.stringify({ available: true, source: `${name}.example` }),
    };
  };

  const events: string[] = [];
  const results = await executeToolBatch(
    [
      { id: '1', name: 'slow', parsed: {} },
      { id: '2', name: 'fast', parsed: {} },
      { id: '3', name: 'medium', parsed: {} },
    ],
    {
      execute: executor,
      onEvent: (event) => events.push(`${event.name}:${event.status}`),
    },
  );

  assert.equal(maxActive, 3);
  assert.deepEqual(results.map((result) => result.call.id), ['1', '2', '3']);
  assert.deepEqual(events.slice(0, 3), ['slow:running', 'fast:running', 'medium:running']);
  assert.equal(results[0].evidence.quality, 'verified-live');
  assert.match(results[0].outcome.json, /"_evidence"/);
});

test('executeToolBatch fails one provider closed without failing sibling tools', async () => {
  const results = await executeToolBatch(
    [
      { id: 'ok', name: 'ok', parsed: {} },
      { id: 'bad', name: 'bad', parsed: {} },
    ],
    {
      execute: async (name) => {
        if (name === 'bad') throw new Error('provider timeout');
        return {
          ok: true,
          summary: 'ok',
          data: { source: 'official.example' },
          json: JSON.stringify({ available: true, source: 'official.example' }),
        };
      },
    },
  );

  assert.equal(results[0].outcome.ok, true);
  assert.equal(results[1].outcome.ok, false);
  assert.equal(results[1].evidence.quality, 'unavailable');
  assert.match(results[1].outcome.json, /provider timeout/);
});
