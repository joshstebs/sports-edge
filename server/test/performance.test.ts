import assert from 'node:assert/strict';
import test from 'node:test';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const now = new Date().toISOString();

test('computePerformance aggregates graded predictions by record, ROI and confidence', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-performance-'));
  process.env.SPORTS_EDGE_DATA_DIR = dir;
  try {
    // Storage drops `outcome` on add (same as production: grading sets it later),
    // so we seed via addPrediction + updatePrediction exactly like the evaluator.
    const store = await import('../src/lib/predictionStore.js');
    const { computePerformance } = await import('../src/lib/performance.js');

    const p1 = await store.addPrediction({
      userId: 'admin',
      timestamp: now,
      sport: 'MLB',
      matchup: 'A vs B',
      bet_type: 'Player Prop',
      legs: [{ leg_name: 'Shohei Ohtani Over 1.5 TB', target_line: '1.5', model_probability: 0.75, implied_odds: '+120', market: 'playerProps', model_version: 'empirical-beta-v1' }],
      status: 'evaluated',
      evaluatedAt: now,
    });
    await store.updatePrediction(p1.prediction_id, {
      legs: [{ ...p1.legs[0], outcome: 'won', actual: 2, evaluated_at: now }] as any,
    });

    const p2 = await store.addPrediction({
      userId: 'admin',
      timestamp: now,
      sport: 'NBA',
      matchup: 'C vs D',
      bet_type: 'Player Prop',
      legs: [{ leg_name: 'Luka Doncic Over 28.5 PTS', target_line: '28.5', model_probability: 0.55, implied_odds: '-110', market: 'playerProps', model_version: 'empirical-beta-v1' }],
      status: 'evaluated',
      evaluatedAt: now,
    });
    await store.updatePrediction(p2.prediction_id, {
      legs: [{ ...p2.legs[0], outcome: 'lost', actual: 24, evaluated_at: now }] as any,
    });

    const perf = await computePerformance();

    assert.equal(perf.overall.graded, 2);
    assert.equal(perf.overall.wins, 1);
    assert.equal(perf.overall.losses, 1);
    // Won +120 => +1.2 units; lost -110 => -0.909 units => ~+0.291.
    assert.ok(Math.abs((perf.overall.units ?? 0) - 0.291) < 1e-2, `units=${perf.overall.units}`);
    assert.ok(Math.abs((perf.overall.winRate ?? 0) - 50) < 1e-6, `winRate=${perf.overall.winRate}`);
    assert.deepEqual(perf.bySport.map((s) => s.sport).sort(), ['MLB', 'NBA']);
    assert.deepEqual(perf.byConfidence.map((b) => b.band).sort(), ['High', 'Low']);
    assert.equal(perf.recent.length, 2);
    assert.equal(store.storageStatus().backend, 'local-json');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    delete process.env.SPORTS_EDGE_DATA_DIR;
  }
});
