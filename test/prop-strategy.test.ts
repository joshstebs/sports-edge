import assert from 'node:assert/strict';
import test from 'node:test';
import type { PlayerResearchObservation } from '../src/lib/api';
import { evaluatePropStrategy } from '../src/lib/propStrategy';

const cutoff = '2026-02-01';
function game(index: number, value: number, date?: string): PlayerResearchObservation {
  return { date: date ?? `2026-01-${String(index).padStart(2, '0')}`, value, minutes: 30 + index / 10,
    opponent: 'Rivals', result: null, gameId: String(index) };
}

test('persistent results produce two shrunk forecasts and use the lower one for pricing', () => {
  const rows = Array.from({ length: 23 }, (_, index) => game(index + 1, 27));
  const result = evaluatePropStrategy([...rows].reverse(), 25.5, 'over', cutoff);
  assert.equal(result.replay.length, 13);
  assert.equal(result.status, 'supported');
  assert.equal(result.strategies[0].estimate, 7 / 9);
  assert.equal(result.strategies[1].estimate, 12 / 14);
  assert.equal(result.estimateForQuotes, 7 / 9);
  assert(result.strategies.every(item => item.brier! < 0.25));
  assert.equal(result.minutes.recent?.sample, 5);
});

test('same-date results, duplicated records, pushes, and current-day data cannot leak into forecasts', () => {
  const history = Array.from({ length: 10 }, (_, index) => game(index + 1, 26));
  const sameDay = [game(11, 20), game(12, 28, '2026-01-11')];
  const rows = [
    game(51, 40, cutoff), ...history, history[0],
    ...sameDay, game(13, 25), game(14, 29),
    game(52, 45, 'unpublished'),
  ];
  const result = evaluatePropStrategy(rows, 25, 'over', cutoff);
  assert.equal(result.pushes, 1);
  assert.equal(result.replay.length, 3);
  assert.deepEqual(result.replay[0].estimates, result.replay[1].estimates);
  assert.equal(result.replay[0].estimates[5], 7 / 9);
  assert.equal(result.replay[2].estimates[5], 6 / 9);
  assert.equal(result.replayDates, 2);
  assert.equal(result.status, 'thin');
  assert.equal(result.estimateForQuotes, null);
});

test('a hot start followed by alternating results does not supply a price estimate', () => {
  const rows = Array.from({ length: 26 }, (_, index) => game(index + 1, index < 10 || index % 2 !== 0 ? 30 : 15));
  const result = evaluatePropStrategy(rows, 20.5, 'over', cutoff);
  assert.equal(result.status, 'weak');
  assert.equal(result.estimateForQuotes, null);
  const under = evaluatePropStrategy(rows, 20.5, 'under', cutoff);
  assert.equal(under.replay[0].result, 1);
  assert.equal(under.replay[0].estimates[10], 2 / 14);
});
