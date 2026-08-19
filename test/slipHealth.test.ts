import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeSlipHealth, formatParlayForClipboard } from '../src/lib/slipHealth';

test('strong slip requires all scored 65+ legs across distinct games', () => {
  const health = analyzeSlipHealth([
    { selection: 'A over', confidence: 70, eventId: '1', game: 'A vs B' },
    { selection: 'B over', confidence: 66, eventId: '2', game: 'C vs D' },
  ]);
  assert.equal(health.level, 'strong');
  assert.equal(health.averageConfidence, 68);
  assert.equal(health.weakestConfidence, 66);
  assert.equal(health.uniqueEvents, 2);
});

test('same-game concentration is visible without inventing a combined probability', () => {
  const health = analyzeSlipHealth([
    { selection: 'A over', confidence: 64, eventId: '1', correlation: 'Positive' },
    { selection: 'B over', confidence: 61, eventId: '1', correlation: 'Positive' },
    { selection: 'C over', confidence: 60, eventId: '2' },
  ]);
  assert.equal(health.level, 'good');
  assert.equal(health.duplicateEventLegs, 1);
  assert.match(health.summary, /share games/i);
});

test('unscored and aggressive slips are clearly flagged', () => {
  assert.equal(analyzeSlipHealth([{ selection: 'Unknown' }]).level, 'unscored');
  assert.equal(analyzeSlipHealth([{ selection: 'Long shot', confidence: 54, eventId: '1' }]).level, 'aggressive');
});

test('explicit negative correlation is surfaced', () => {
  const health = analyzeSlipHealth([
    { selection: 'A', confidence: 62, eventId: '1', correlation: 'Negative - conflicting game script' },
    { selection: 'B', confidence: 61, eventId: '2' },
  ]);
  assert.equal(health.negativeCorrelations, 1);
  assert.match(health.summary, /negative\/conflicting correlation/i);
});

test('copy formatter includes selection, confidence, odds and game context', () => {
  const text = formatParlayForClipboard([
    { sport: 'MLB', game: 'Blue Jays vs Yankees', selection: 'Player OVER 1.5 TB', confidence: 63, odds: -110 },
  ]);
  assert.match(text, /SportsEdge Parlay/);
  assert.match(text, /Player OVER 1.5 TB \| 63% confidence \| -110/);
  assert.match(text, /MLB · Blue Jays vs Yankees/);
});
