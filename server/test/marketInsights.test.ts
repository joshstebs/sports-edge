import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMarketInsights } from '../src/lib/marketInsights.js';
import type { Prediction } from '../src/lib/predictionStore.js';

function prediction(overrides: Partial<Prediction> = {}): Prediction {
  return {
    prediction_id: 'p1',
    timestamp: '2026-08-19T01:00:00Z',
    sport: 'MLB',
    matchup: 'Blue Jays vs Pirates',
    bet_type: 'PROP',
    gameDate: '2026-08-19',
    status: 'pending',
    legs: [{
      leg_name: 'Vladimir Guerrero Jr. OVER 1.5 total bases',
      target_line: '1.5',
      market: 'total_bases',
      model_probability: 0.64,
      implied_odds: -105,
      model_version: 'empirical-beta-v1',
      model_source: 'official fixture',
    }],
    ...overrides,
  };
}

test('top edges ranks positive verified price edges and filters weak/non-positive picks', () => {
  const strong = prediction();
  const weak = prediction({
    prediction_id: 'p2',
    legs: [{ leg_name: 'Weak pick', target_line: '1.5', model_probability: 0.57, implied_odds: +120 }],
  });
  const noEdge = prediction({
    prediction_id: 'p3',
    legs: [{ leg_name: 'No edge', target_line: '1.5', model_probability: 0.58, implied_odds: -180 }],
  });
  const insights = buildMarketInsights([weak, noEdge, strong], new Date('2026-08-19T14:00:00Z'));
  assert.equal(insights.topEdges.length, 1);
  assert.equal(insights.topEdges[0].selection, strong.legs[0].leg_name);
  assert.equal(insights.topEdges[0].confidence, 64);
  assert.ok((insights.topEdges[0].edgePct ?? 0) > 10);
});

test('top edges preserves high-confidence unpriced recommendations after priced edges', () => {
  const priced = prediction();
  const unpriced = prediction({
    prediction_id: 'p2',
    legs: [{ leg_name: 'Unpriced strong pick', target_line: '2.5', model_probability: 0.7, implied_odds: null, model_version: 'm2', model_source: 'fixture' }],
  });
  const insights = buildMarketInsights([unpriced, priced], new Date('2026-08-19T14:00:00Z'));
  assert.equal(insights.topEdges.length, 2);
  assert.notEqual(insights.topEdges[0].edgePct, null);
  assert.equal(insights.topEdges[1].edgePct, null);
});

test('calibration detects mature overconfidence and leaves small samples provisional', () => {
  const mature: Prediction[] = Array.from({ length: 20 }, (_, i) => prediction({
    prediction_id: `p${i}`,
    status: 'evaluated',
    legs: [{
      leg_name: `Pick ${i}`,
      target_line: '1.5',
      model_probability: 0.7,
      outcome: i < 10 ? 'won' : 'lost',
    }],
  }));
  const result = buildMarketInsights(mature, new Date('2026-08-19T14:00:00Z'));
  assert.equal(result.calibration.graded, 20);
  assert.equal(result.calibration.averageConfidence, 70);
  assert.equal(result.calibration.hitRate, 50);
  assert.equal(result.calibration.status, 'overconfident');

  const small = buildMarketInsights(mature.slice(0, 5), new Date('2026-08-19T14:00:00Z'));
  assert.equal(small.calibration.status, 'insufficient-data');
});

test('CLV is calculated only from an actual stored closing price', () => {
  const withClose = prediction({
    status: 'evaluated',
    legs: [{
      leg_name: 'Priced pick',
      target_line: '1.5',
      model_probability: 0.64,
      implied_odds: +110,
      outcome: 'won',
      closing_odds: -110,
    } as any],
  });
  const withoutClose = prediction({
    prediction_id: 'p2',
    status: 'evaluated',
    legs: [{ leg_name: 'No close', target_line: '2.5', model_probability: 0.62, implied_odds: -105, outcome: 'lost' }],
  });
  const insights = buildMarketInsights([withClose, withoutClose], new Date('2026-08-19T14:00:00Z'));
  assert.equal(insights.clv.eligiblePriced, 2);
  assert.equal(insights.clv.tracked, 1);
  assert.equal(insights.clv.coveragePct, 50);
  assert.equal(insights.clv.positiveClv, 1);
  assert.ok((insights.clv.averagePriceEdgePct ?? 0) > 0);
});
