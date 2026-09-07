import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalPropMarket, isPlausiblePropLine, propLineIntegrity } from '../src/models/propLineIntegrity.js';
import { evaluatePropLine } from '../src/models/propLineEvaluation.js';

test('canonicalizes player markets without conflating hits and total bases', () => {
  assert.equal(canonicalPropMarket('player_total_bases', 'mlb'), 'totalBases');
  assert.equal(canonicalPropMarket('batter_hits', 'mlb'), 'hits');
  assert.notEqual(canonicalPropMarket('player_total_bases', 'mlb'), canonicalPropMarket('player_hits', 'mlb'));
});

test('accepts real half/integer lines across a broad range and rejects malformed rows', () => {
  assert.equal(isPlausiblePropLine('mlb', 'totalBases', 1.5), true);
  assert.equal(isPlausiblePropLine('mlb', 'totalBases', 2.5), true);
  assert.equal(isPlausiblePropLine('mlb', 'totalBases', 2.25), false);
  assert.equal(isPlausiblePropLine('mlb', 'not-a-market', 1.5), false);
  assert.equal(propLineIntegrity('mlb', 'totalBases', 99).valid, false);
});

test('revalues both sides at the actual book line instead of carrying a stale under', () => {
  const observations = [0, 1, 1, 2, 2, 3, 3, 4].map((value) => ({ value }));
  const result = evaluatePropLine({
    sport: 'mlb',
    market: 'totalBases',
    line: 1.5,
    observations,
    source: 'test',
    oddsOver: 120,
    oddsUnder: -110,
  });
  assert.equal(result.chosen?.side, 'over');
  assert.equal(result.chosen?.line, 1.5);
  assert.ok((result.edgeOver ?? 0) > 0);
});
