import assert from 'node:assert/strict';
import test from 'node:test';
import { renderScreenerSummaryBlocks } from '../src/llm/screenerRenderer.js';
import { finalizeStructuredParlay, parseParlayQualityPolicy } from '../src/lib/parlayQuality.js';

function candidate(index: number, marketLine: number | null) {
  return {
    player: `Receiver ${index}`,
    playerId: String(index),
    team: 'Buffalo Bills',
    opponent: 'Detroit Lions',
    sport: 'nfl',
    eventDate: '2026-09-17',
    eventId: 'nfl-buf-det',
    market: 'receivingYards',
    side: 'over',
    suggestedLine: 49.5,
    marketLine,
    marketOddsOver: -110,
    marketOddsUnder: -110,
    marketSource: marketLine == null ? null : 'sportsbook-consensus',
    confidencePct: 70 - index,
    grade: 'B',
    sampleSize: 20,
    modelVersion: 'empirical-beta-v1',
    source: 'site.web.api.espn.com',
    inLineupToday: true,
  };
}

function sgpLegs(text: string): any[] {
  const match = /\`\`\`sgp\s*([\s\S]*?)\`\`\`/.exec(text);
  assert.ok(match, 'renderer must emit one structured SGP block');
  return JSON.parse(match[1]).legs;
}

test('renderer-to-finalizer pipeline backfills to a complete six-leg SGP', () => {
  const rendered = renderScreenerSummaryBlocks([
    candidate(0, null),
    ...Array.from({ length: 6 }, (_, index) => candidate(index + 1, 49.5)),
  ], 6);
  const legs = sgpLegs(rendered);
  assert.equal(Array.isArray(legs), true);
  assert.equal(legs.length, 7, 'renderer preserves alternates for downstream backfill');

  const result = finalizeStructuredParlay(
    legs,
    parseParlayQualityPolicy('Build a 5-6 leg same game parlay'),
    Date.now(),
  );
  assert.equal(result.complete, true);
  assert.equal(result.legs.length, 6);
  assert.equal(result.lineBlocked.length, 1);
  assert.ok(result.legs.every((leg) => leg.event_id === 'nfl-buf-det'));
  assert.ok(result.legs.every((leg) => leg.line_verified === true));
});

test('renderer-to-finalizer pipeline refuses an incomplete structured slip', () => {
  const rendered = renderScreenerSummaryBlocks(
    Array.from({ length: 4 }, (_, index) => candidate(index + 1, 49.5)),
    6,
  );
  const result = finalizeStructuredParlay(
    sgpLegs(rendered),
    parseParlayQualityPolicy('Build a 5-6 leg SGP'),
    Date.now(),
  );
  assert.equal(result.complete, false);
  assert.equal(result.shortfall, 1);
  assert.deepEqual(result.legs, []);
});
