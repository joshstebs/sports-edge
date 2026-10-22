import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { playerResearchRouter } from '../src/routes/playerResearch.js';
import { getGameLog } from '../src/providers/mlbStatsApi.js';

test('MLB research serializes opponent names and a short cached window cannot truncate later research', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ stats: [{ splits: Array.from({ length: 20 }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, '0')}`, opponent: { id: 1, name: 'Fixture Opponent' }, gamePk: i, stat: { atBats: 4, hits: i % 3 } })) }] }), { status: 200 });
  try {
    assert.equal((await getGameLog(999991, 'hitting', '2026', 5)).data?.length, 5);
    assert.equal((await getGameLog(999991, 'hitting', '2026', 20)).data?.length, 20);
  } finally { globalThis.fetch = originalFetch; }
  const app = express(); app.use(playerResearchRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/player-research?sport=MLB&name=Fixture&market=hits&limit=5`;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.startsWith('http://127.0.0.1:')) return originalFetch(input, init);
    if (url.includes('/people/search')) return new Response(JSON.stringify({ people: [{ id: 999991, fullName: 'Fixture Player' }] }));
    throw new Error('Unexpected provider request in test');
  };
  try {
    const response = await fetch(url);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.observations[0].opponent, 'Fixture Opponent');
    assert.equal(body.observations.length, 5);
  } finally {
    globalThis.fetch = originalFetch;
    await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
});
