import assert from 'node:assert/strict';
import test from 'node:test';
import {
  filterParlayQuality,
  parseParlayQualityPolicy,
  requestedParlayShortfall,
} from '../src/lib/parlayQuality.js';

test('normal 5-6 leg parlay requires B grade or better', () => {
  const policy = parseParlayQualityPolicy('Give me the best 5-6 game parlay');
  assert.equal(policy.aggressive, false);
  assert.equal(policy.sameGameIntent, false);
  assert.equal(policy.minConfidence, 58);
  assert.equal(policy.requestedMin, 5);
  assert.equal(policy.requestedMax, 6);

  const result = filterParlayQuality([
    { player_name: 'A', confidence: 70 },
    { player_name: 'B', confidence: 61 },
    { player_name: 'C', confidence: 57 },
    { player_name: 'D', confidence: 44 },
  ], policy);

  assert.deepEqual(result.legs.map((leg) => leg.player_name), ['A', 'B']);
  assert.deepEqual(result.blocked.map((leg) => leg.player_name), ['C', 'D']);
});

test('aggressive request may include C but never D', () => {
  const policy = parseParlayQualityPolicy('Build an aggressive high-risk 6-leg parlay');
  const result = filterParlayQuality([
    { player_name: 'A', confidence: 65 },
    { player_name: 'C', confidence: 52 },
    { player_name: 'D', confidence: 49 },
  ], policy);

  assert.equal(policy.minConfidence, 50);
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

test('team and game markets require attributable quality evidence', () => {
  const policy = parseParlayQualityPolicy('Give me the best 3-leg parlay');
  const result = filterParlayQuality([
    { entity_type: 'team', selection: 'Toronto ML', confidence: 63 },
    { entity_type: 'game', selection: 'Over 8.5', confidence: 61, quality_source: 'game-model-v1' },
    { entity_type: 'team', selection: 'Boston ML', confidence: 60, model_source: 'team-model-v1' },
  ], policy);
  assert.deepEqual(result.legs.map((leg) => leg.selection), ['Over 8.5', 'Boston ML']);
  assert.deepEqual(result.blocked.map((leg) => leg.selection), ['Toronto ML']);
});

test('normal parlays reject explicitly negative correlation', () => {
  const policy = parseParlayQualityPolicy('Give me the best 3-leg parlay');
  const result = filterParlayQuality([
    { player_name: 'A', confidence: 68, correlation: 'Positive - same game script' },
    { player_name: 'B', confidence: 64, correlation: 'Negative - conflicts with leg A' },
  ], policy);
  assert.deepEqual(result.legs.map((leg) => leg.player_name), ['A']);
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
  const result = filterParlayQuality([
    { player_name: 'A1', confidence: 72, event_id: 'game-a' },
    { player_name: 'A2', confidence: 70, event_id: 'game-a' },
    { player_name: 'B1', confidence: 66, event_id: 'game-b' },
  ], policy);
  assert.deepEqual(result.legs.map((leg) => leg.player_name), ['A1', 'A2', 'B1']);
});

test('reports requested-count shortfall instead of padding', () => {
  const policy = parseParlayQualityPolicy('Give me 6 picks');
  assert.equal(requestedParlayShortfall(policy, 4), 2);
  assert.equal(requestedParlayShortfall(policy, 6), 0);
});
