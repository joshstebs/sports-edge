import assert from 'node:assert/strict';
import test from 'node:test';
import {
  filterParlayQuality,
  finalizeStructuredParlay,
  parseParlayQualityPolicy,
  requestedParlayShortfall,
} from '../src/lib/parlayQuality.js';

test('explicit 5-6 leg request fills shortfall with strongest C+ supplemental picks', () => {
  const policy = parseParlayQualityPolicy('Give me the best 5-6 game parlay');
  assert.equal(policy.aggressive, false);
  assert.equal(policy.sameGameIntent, false);
  assert.equal(policy.minConfidence, 58);
  assert.equal(policy.supplementalMinConfidence, 54);
  assert.equal(policy.targetFill, true);
  assert.equal(policy.requestedMin, 5);
  assert.equal(policy.requestedMax, 6);

  const result = filterParlayQuality([
    { player_name: 'A', confidence: 70, event_id: 'a' },
    { player_name: 'B', confidence: 61, event_id: 'b' },
    { player_name: 'C1', confidence: 57, event_id: 'c' },
    { player_name: 'C2', confidence: 56, event_id: 'd' },
    { player_name: 'C3', confidence: 54, event_id: 'e' },
    { player_name: 'TooWeak', confidence: 53, event_id: 'f' },
    { player_name: 'D', confidence: 44, event_id: 'g' },
  ], policy);

  assert.deepEqual(result.legs.map((leg) => leg.player_name), ['A', 'B', 'C1', 'C2', 'C3']);
  assert.equal(result.coreCount, 2);
  assert.equal(result.supplementalCount, 3);
  assert.deepEqual(result.legs.slice(2).map((leg: any) => leg.quality_tier), ['supplemental', 'supplemental', 'supplemental']);
  assert.deepEqual(result.blocked.map((leg) => leg.player_name).sort(), ['D', 'TooWeak'].sort());
});

test('no explicit multi-pick count keeps normal B-grade floor', () => {
  const policy = parseParlayQualityPolicy('Give me the best MLB props');
  assert.equal(policy.targetFill, false);
  const result = filterParlayQuality([
    { player_name: 'A', confidence: 62 },
    { player_name: 'C', confidence: 57 },
  ], policy);
  assert.deepEqual(result.legs.map((leg) => leg.player_name), ['A']);
  assert.deepEqual(result.blocked.map((leg) => leg.player_name), ['C']);
});

test('hyphenated single leg counts are parsed and capped', () => {
  const policy = parseParlayQualityPolicy('Give me the best 3-leg parlay');
  assert.equal(policy.requestedMin, 3);
  assert.equal(policy.requestedMax, 3);
  assert.equal(policy.targetFill, true);
});

test('aggressive request may include C but never D', () => {
  const policy = parseParlayQualityPolicy('Build an aggressive high-risk 6-leg parlay');
  const result = filterParlayQuality([
    { player_name: 'A', confidence: 65 },
    { player_name: 'C', confidence: 52 },
    { player_name: 'D', confidence: 49 },
  ], policy);

  assert.equal(policy.minConfidence, 50);
  assert.equal(policy.targetFill, false);
  assert.equal(policy.requestedMin, 6);
  assert.equal(policy.requestedMax, 6);
  assert.deepEqual(result.legs.map((leg) => leg.player_name), ['A', 'C']);
  assert.deepEqual(result.blocked.map((leg) => leg.player_name), ['D']);
});

test('missing player confidence fails closed', () => {
  const policy = parseParlayQualityPolicy('Give me a 4 leg parlay');
  const result = filterParlayQuality([
    { player_name: 'Unknown' },
    { player_name: 'Modeled', model_probability: '60' },
  ], policy);
  assert.deepEqual(result.legs.map((leg) => leg.player_name), ['Modeled']);
  assert.deepEqual(result.blocked.map((leg) => leg.player_name), ['Unknown']);
});

test('team and game markets require both confidence and attributable quality evidence', () => {
  const policy = parseParlayQualityPolicy('Give me the best 3-leg parlay');
  const result = filterParlayQuality([
    { entity_type: 'team', selection: 'Toronto ML', confidence: 63 },
    { entity_type: 'game', selection: 'Over 8.5', quality_source: 'game-model-v1' },
    { entity_type: 'game', selection: 'Under 7.5', confidence: 61, quality_source: 'game-model-v1' },
    { entity_type: 'team', selection: 'Boston ML', confidence: 60, model_source: 'team-model-v1' },
  ], policy);
  assert.deepEqual(result.legs.map((leg) => leg.selection), ['Under 7.5', 'Boston ML']);
  assert.deepEqual(result.blocked.map((leg) => leg.selection), ['Toronto ML', 'Over 8.5']);
});

test('normal parlays reject explicitly negative correlation even in target-fill mode', () => {
  const policy = parseParlayQualityPolicy('Give me the best 3-leg parlay');
  const result = filterParlayQuality([
    { player_name: 'A', confidence: 68, correlation: 'Positive - same game script' },
    { player_name: 'B', confidence: 57, correlation: 'Negative - conflicts with leg A' },
    { player_name: 'C', confidence: 56, correlation: 'Neutral' },
  ], policy);
  assert.deepEqual(result.legs.map((leg) => leg.player_name), ['A', 'C']);
  assert.deepEqual(result.blocked.map((leg) => leg.player_name), ['B']);
});

test('cross-slate parlays prefer event diversity before duplicate-game legs', () => {
  const policy = parseParlayQualityPolicy('Give me the best 3-leg parlay');
  const result = filterParlayQuality([
    { player_name: 'A1', confidence: 72, event_id: 'game-a' },
    { player_name: 'A2', confidence: 70, event_id: 'game-a' },
    { player_name: 'B1', confidence: 66, event_id: 'game-b' },
    { player_name: 'C1', confidence: 62, event_id: 'game-c' },
  ], policy);
  assert.deepEqual(result.legs.map((leg) => leg.player_name), ['A1', 'B1', 'C1']);
});

test('same-game intent keeps confidence ranking without diversity penalty', () => {
  const policy = parseParlayQualityPolicy('Build a 3-leg SGP');
  assert.equal(policy.sameGameIntent, true);
  assert.equal(policy.requestedMax, 3);
  const result = filterParlayQuality([
    { player_name: 'A1', confidence: 72, event_id: 'game-a' },
    { player_name: 'A2', confidence: 70, event_id: 'game-a' },
    { player_name: 'B1', confidence: 66, event_id: 'game-b' },
  ], policy);
  assert.deepEqual(result.legs.map((leg) => leg.player_name), ['A1', 'A2', 'B1']);
});

test('reports requested-count shortfall after target-fill candidates are exhausted', () => {
  const policy = parseParlayQualityPolicy('Give me 6 picks');
  assert.equal(requestedParlayShortfall(policy, 4), 2);
  assert.equal(requestedParlayShortfall(policy, 6), 0);
});


const NOW_MS = Date.parse('2026-09-17T16:00:00.000Z');

function liveNflLeg(player: string, eventId: string, confidence = 60, extra: Record<string, unknown> = {}) {
  return {
    entity_type: 'player',
    sport: 'NFL',
    event_id: eventId,
    player_name: player,
    selection: `${player} OVER 49.5 Receiving Yards`,
    market: 'receivingYards',
    side: 'over',
    line: 49.5,
    odds: -110,
    line_verified: true,
    line_source: 'sportsbook-consensus',
    line_checked_at: '2026-09-17T15:55:00.000Z',
    confidence,
    ...extra,
  };
}

test('structured parlay backfills a rejected top row and returns the full requested count', () => {
  const policy = parseParlayQualityPolicy('Build a 5-6 leg SGP');
  const candidates = [
    liveNflLeg('Stale Player', 'game-a', 75, { line_checked_at: '2026-09-17T14:00:00.000Z' }),
    ...Array.from({ length: 6 }, (_, index) => liveNflLeg(`Player ${index + 1}`, 'game-a', 68 - index)),
  ];
  const result = finalizeStructuredParlay(candidates, policy, NOW_MS);
  assert.equal(result.complete, true);
  assert.equal(result.legs.length, 6);
  assert.equal(result.lineBlocked.length, 1);
  assert.ok(result.legs.every((leg) => leg.event_id === 'game-a'));
});

test('structured parlay emits no partial slip when requested minimum cannot be filled', () => {
  const policy = parseParlayQualityPolicy('Build a 5-6 leg SGP');
  const result = finalizeStructuredParlay(
    Array.from({ length: 4 }, (_, index) => liveNflLeg(`Player ${index + 1}`, 'game-a')),
    policy,
    NOW_MS,
  );
  assert.equal(result.complete, false);
  assert.equal(result.qualified.length, 4);
  assert.equal(result.shortfall, 1);
  assert.deepEqual(result.legs, []);
});

test('same-game finalization never mixes events', () => {
  const policy = parseParlayQualityPolicy('Build a 3-leg SGP');
  const result = finalizeStructuredParlay([
    liveNflLeg('A1', 'game-a', 70),
    liveNflLeg('A2', 'game-a', 68),
    liveNflLeg('B1', 'game-b', 72),
    liveNflLeg('B2', 'game-b', 69),
    liveNflLeg('B3', 'game-b', 67),
  ], policy, NOW_MS);
  assert.equal(result.complete, true);
  assert.equal(result.legs.length, 3);
  assert.ok(result.legs.every((leg) => leg.event_id === 'game-b'));
});

test('model-only and explicitly unverified lines cannot enter a structured slip', () => {
  const policy = parseParlayQualityPolicy('Give me 1 pick');
  const result = finalizeStructuredParlay([
    liveNflLeg('Model Line', 'game-a', 70, {
      line_verified: false,
      line_source: 'model-derived',
    }),
  ], policy, NOW_MS);
  assert.equal(result.complete, false);
  assert.equal(result.lineBlocked.length, 1);
  assert.deepEqual(result.legs, []);
});

test('written five-to-six SGP request preserves its full count range', () => {
  const policy = parseParlayQualityPolicy('Build a five to six leg Same Game Parlay');
  assert.equal(policy.requestedMin, 5);
  assert.equal(policy.requestedMax, 6);
  assert.equal(policy.sameGameIntent, true);
});
