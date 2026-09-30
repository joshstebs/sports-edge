import assert from 'node:assert/strict';
import test from 'node:test';
import { walkForwardReport } from '../src/lib/walkForward.js';
import type { Prediction } from '../src/lib/predictionStore.js';

function record(day: number, settledDay: number, outcome: 'won' | 'lost', model = 'model-a'): Prediction {
  return {
    prediction_id: `p-${day}-${model}`, timestamp: `2026-09-${String(day).padStart(2, '0')}T12:00:00Z`,
    sport: 'NFL', matchup: 'A vs B', bet_type: 'PROP', status: 'evaluated',
    evaluatedAt: `2026-09-${String(settledDay).padStart(2, '0')}T02:00:00Z`,
    legs: [{ leg_name: 'A over 49.5', target_line: '49.5', market: 'receivingYards',
      model_version: model, model_probability: 60, implied_odds: -110, outcome }],
  };
}

test('walk-forward uses only already settled prior days and separates model versions', () => {
  const predictions = [record(1, 4, 'won'), record(2, 3, 'lost'), record(3, 4, 'won'), record(4, 5, 'won'), record(4, 5, 'lost', 'model-b')];
  const report = walkForwardReport(predictions, 1);
  assert.equal(report.skipped.noHistory, 4);
  assert.equal(report.rows.length, 1);
  assert.equal(report.rows[0].samples, 1);
  assert.equal(report.rows[0].model, 'model-a');
  assert.ok(report.rows[0].brier > 0);
});

test('walk-forward refuses missing prices and outcomes known before the recommendation', () => {
  const early = record(2, 1, 'won');
  const unpriced = record(3, 4, 'won');
  unpriced.legs[0].implied_odds = null;
  const report = walkForwardReport([early, unpriced], 0);
  assert.equal(report.skipped.invalid, 1);
  assert.equal(report.skipped.unpriced, 1);
  assert.deepEqual(report.rows, []);
});
