import test from 'node:test';
import assert from 'node:assert/strict';
import { edgePickToLeg, marketFamily, priceScenario, quoteAge, researchSummary } from '../src/lib/research';
import type { TopEdgePick } from '../src/lib/api';

test('price lab crosses from positive to negative when the same selection gets more expensive', () => {
  const fair = priceScenario(60, -150)!;
  assert.ok(Math.abs(fair.ev) < 1e-10);
  assert.ok(priceScenario(60, -110)!.ev > 0);
  assert.ok(priceScenario(60, -200)!.ev < 0);
  for (const odds of [NaN, 0, 99, -99, Infinity]) assert.equal(priceScenario(60, odds), null);
  for (const p of [-1, NaN, 0, 100, 101]) assert.equal(priceScenario(p, 100), null);
});

test('research keeps pushes out of the decision denominator and respects short windows', () => {
  const games = [3, 2, 1, NaN, 4].map((value) => ({ value, date: null, opponent: null, result: null, gameId: null }));
  const over = researchSummary(games, 2, 'over', 3);
  assert.equal(over.games.length, 3);
  assert.equal(over.hits, 1);
  assert.equal(over.pushes, 1);
  assert.equal(over.rate, 50);
  assert.equal(over.average, 2);
  assert.equal(researchSummary(games.slice(1, 2), 2, 'over', 20).rate, null);
  assert.equal(researchSummary([], 2, 'under', 5).average, null);
});

test('freshness flags old, invalid and future timestamps without inventing quote capture time', () => {
  const now = Date.parse('2026-10-22T18:00:00Z');
  assert.equal(quoteAge('2026-10-22T17:46:00Z', now).review, false);
  assert.equal(quoteAge('2026-10-22T17:45:00Z', now).review, true);
  assert.equal(quoteAge('bad', now).label, 'Time unverified');
  assert.equal(quoteAge('2026-10-22T19:00:00Z', now).review, true);
});

test('prop markets containing total remain props', () => {
  assert.equal(marketFamily('totalBases'), 'Player Props');
  assert.equal(marketFamily('total_bases'), 'Player Props');
  assert.equal(marketFamily('game_total'), 'Total');
});

test('both pick entry points retain event date, matchup, line and model provenance', () => {
  const pick: TopEdgePick = { predictionId: 'p1', sport: 'NFL', matchup: 'BUF @ MIA', selection: 'Player over 49.5', market: 'receivingYards', line: 49.5, eventDate: '2026-10-22', recommendedAt: '2026-10-22T17:00:00Z', confidence: 60, odds: -110, impliedProbability: 52.4, edgePct: 7.6, model: 'empirical-beta-v1', source: 'official logs', modelSampleSize: 10 };
  const leg = edgePickToLeg(pick);
  assert.equal(leg.game, pick.matchup);
  assert.equal(leg.eventDate, pick.eventDate);
  assert.equal(leg.line, pick.line);
  assert.equal(leg.model_source, pick.source);
  assert.equal(leg.model_sample_size, 10);
});
