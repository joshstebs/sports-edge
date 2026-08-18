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

test('team and game markets are preserved without player-model confidence', () => {
  const policy = parseParlayQualityPolicy('Give me the best 3-leg parlay');
  const result = filterParlayQuality([
    { entity_type: 'team', selection: 'Toronto ML' },
    { entity_type: 'game', selection: 'Over 8.5' },
  ], policy);
  assert.equal(result.legs.length, 2);
  assert.equal(result.blocked.length, 0);
});

test('reports requested-count shortfall instead of padding', () => {
  const policy = parseParlayQualityPolicy('Give me 6 picks');
  assert.equal(requestedParlayShortfall(policy, 4), 2);
  assert.equal(requestedParlayShortfall(policy, 6), 0);
});
