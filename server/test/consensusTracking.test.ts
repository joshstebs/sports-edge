import assert from 'node:assert/strict';
import test from 'node:test';
import { findBestLine, type OddsMarket } from '../src/providers/oddsAggregator.js';
import { renderScreenerSummaryBlocks } from '../src/llm/screenerRenderer.js';

function row(line: number, odds: number, book: string): OddsMarket {
  return { market: 'player_total_bases', side: 'over', line, odds, book, lastUpdated: '2026-09-06T12:00:00Z' };
}

test('consensus line beats a one-book alternate line', () => {
  const markets = [
    row(1.5, -115, 'A'),
    row(1.5, -105, 'B'),
    row(1.5, -110, 'C'),
    row(2.5, 145, 'D'),
  ];
  const best = findBestLine(markets, 'player_total_bases', 'over');
  assert.equal(best?.line, 1.5);
  assert.equal(best?.book, 'B');
  assert.equal(best?.odds, -105);
});

test('fast screener renderer uses live primary line and emits prediction log', () => {
  const text = renderScreenerSummaryBlocks([{
    player: 'Example Player', team: 'Away', opponent: 'Home', sport: 'mlb',
    eventDate: '2026-09-06', eventId: 123, market: 'totalBases', side: 'over',
    suggestedLine: 2.5, marketLine: 1.5, marketOddsOver: -110, marketOddsUnder: -120,
    lineLabel: 'PRIMARY / CONSENSUS LINE', alternateLines: [{ line: 2.5 }],
    confidencePct: 61, grade: 'B', sampleSize: 20, modelVersion: 'empirical-beta-v1',
    source: 'statsapi.mlb.com', inLineupToday: true,
  }], 1);
  assert.match(text, /total Bases OVER 1\.5/i);
  assert.match(text, /PRIMARY \/ CONSENSUS LINE/);
  assert.match(text, /Alternate lines available but deprioritized: 2\.5/);
  assert.match(text, /\`\`\`sgp/);
  assert.match(text, /\[PREDICTION_LOG\]/);
  assert.doesNotMatch(text, /OVER 2\.5 total Bases/i);
});

test('provisional MLB screener rows are shown but not persisted', () => {
  const text = renderScreenerSummaryBlocks([{
    player: 'Pre Lineup', team: 'Away', opponent: 'Home', sport: 'mlb',
    eventDate: '2026-09-06', eventId: 456, market: 'hits', side: 'over',
    suggestedLine: 0.5, marketLine: 0.5, confidencePct: 60, grade: 'B',
    sampleSize: 20, modelVersion: 'empirical-beta-v1', source: 'statsapi.mlb.com',
    inLineupToday: false,
  }], 1);
  assert.match(text, /provisional/i);
  assert.match(text, /\`\`\`sgp/);
  assert.doesNotMatch(text, /\[PREDICTION_LOG\]/);
});
