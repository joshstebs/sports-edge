import assert from 'node:assert/strict';
import test from 'node:test';
import type { CandidateHistoryRecord } from '../src/candidates/candidateHistory.js';
import { adjustedPropProbability, learnPropTrends } from '../src/candidates/propLearning.js';

const now = Date.parse('2026-02-01T00:00:00Z');

function fixtures(reversed = false): CandidateHistoryRecord[] {
  return Array.from({ length: 60 }, (_, index) => {
    const day = Math.floor(index / 5) + 1;
    const date = `2026-01-${String(day).padStart(2, '0')}`;
    const won = reversed && day >= 9 ? index % 5 < 4 : index % 5 < 2;
    return {
      id: String(index), evaluatedAt: date + 'T19:00:00Z',
      eventDate: date, eventId: `game-${index}`, sport: 'nba', player: `player-${index}`,
      team: null, opponent: null, market: 'points', side: 'over', line: 20.5,
      modelProbability: 0.62, grade: 'B', sampleSize: 16, modelVersion: 'v1',
      modelSource: 'test', sources: ['test'], fallbackUsed: false,
      actual: won ? 24 : 20, outcome: won ? 'won' : 'lost', gradedAt: date + 'T23:00:00Z',
      price: { americanOdds: -110, source: 'test', checkedAt: date + 'T18:59:00Z', eventStart: date + 'T20:00:00Z' },
    };
  });
}

test('learns a bounded direction-specific adjustment only with better later results', () => {
  const rows = fixtures();
  const learning = learnPropTrends(rows, now);
  const trend = learning.getTrend(rows[0]);
  assert(trend);
  assert.equal(trend.adjustment, -0.06);
  assert.equal(trend.trainCount, 40);
  assert.equal(trend.holdoutCount, 20);
  assert(trend.adjustedBrier < trend.baselineBrier);
  assert.equal(learning.getTrend({ ...rows[0], side: 'under' }), null);
  assert.equal(learning.getTrend({ ...rows[0], modelVersion: 'v2' }), null);
  assert.equal(adjustedPropProbability(0.04, trend.adjustment), 0.01);
});

test('rejects a historical trend that reverses in later results', () => {
  const rows = fixtures(true);
  const learning = learnPropTrends(rows, now);
  assert.equal(learning.report.trends[0].active, false);
  assert.equal(learning.getTrend(rows[0]), null);
});

test('excludes research lines, after-tip captures and results unavailable at training time', () => {
  const rows = fixtures();
  rows[0].price = undefined;
  rows[1].evaluatedAt = rows[1].price!.eventStart;
  rows[2].line = 20;
  rows[3].gradedAt = '2026-03-01T00:00:00Z';
  for (const row of rows.slice(4, 40)) row.gradedAt = '2026-01-15T00:00:00Z';
  const learning = learnPropTrends(rows, now);
  assert.equal(learning.report.tracked, 57);
  assert.equal(learning.report.settled, 56);
  assert.deepEqual(learning.report.trends, []);
});
