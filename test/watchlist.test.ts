import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compareSnapshots,
  loadWatchlist,
  saveWatchlist,
  upsertWatch,
  watchlistStorageKey,
  type WatchItem,
} from '../src/lib/watchlist';

function memory() {
  const bag = new Map<string, string>();
  return {
    getItem: (key: string) => bag.get(key) ?? null,
    setItem: (key: string, value: string) => { bag.set(key, value); },
  };
}

test('watchlists are isolated by authenticated user', () => {
  const storage = memory();
  const item: WatchItem = {
    id: 'a',
    kind: 'player',
    createdAt: '2026-10-23T00:00:00.000Z',
    sport: 'NFL',
    label: 'Example Player',
    player: 'Example Player',
  };
  saveWatchlist('user-a', [item], storage);
  saveWatchlist('user-b', [], storage);
  assert.equal(loadWatchlist('user-a', storage).length, 1);
  assert.equal(loadWatchlist('user-b', storage).length, 0);
  assert.notEqual(watchlistStorageKey('user-a'), watchlistStorageKey('user-b'));
});

test('upsert replaces the same research identity', () => {
  const base: WatchItem = {
    id: '1',
    kind: 'research',
    createdAt: '2026-10-23T00:00:00.000Z',
    sport: 'NBA',
    label: 'Player · Points',
    player: 'Player',
    market: 'points',
    line: 22.5,
    side: 'over',
  };
  const next = upsertWatch([base], { ...base, id: '2', line: 24.5 });
  assert.equal(next.length, 2);
  const replaced = upsertWatch([base], { ...base, id: '2' });
  assert.equal(replaced.length, 1);
  assert.equal(replaced[0].id, '2');
});

test('snapshot comparison requires the same line and side', () => {
  const previous = { checkedAt: '2026-10-22T12:00:00.000Z', average: 21, sample: 10, hitRate: 60, line: 20.5, side: 'over' as const };
  const next = { ...previous, checkedAt: '2026-10-23T12:00:00.000Z', average: 22, hitRate: 70 };
  assert.match(compareSnapshots(previous, next) ?? '', /Average \+1\.00/);
  assert.equal(compareSnapshots(previous, { ...next, line: 18.5 }), null);
  assert.equal(compareSnapshots(undefined, next), null);
});
