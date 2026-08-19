import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlayerPropModel, espnObservation, mlbObservation, normalizeMarket } from '../src/models/playerPropModel.js';
import { buildLearningContext, evaluateEspnLegFromStats } from '../src/lib/evaluator.js';
import type { Prediction } from '../src/lib/predictionStore.js';

test('market extraction covers MLB, NFL, NBA and NHL without filling missing stats with zero', () => {
  assert.equal(mlbObservation('total_bases', { hits: 2, doubles: 1, triples: 0, homeRuns: 1 }), 6);
  assert.equal(espnObservation('nfl', 'rushing_receiving_yards', { rushingYards: '24', receivingYards: '61' }), 85);
  assert.equal(espnObservation('nba', 'pra', { points: '25', totalRebounds: '8', assists: '7' }), 40);
  assert.equal(espnObservation('nhl', 'hockey_points', { goals: '1', assists: '2' }), 3);
  assert.equal(espnObservation('nhl', 'saves', {}), null);
  assert.equal(espnObservation('nfl', 'touchdowns', {}), null);
  assert.equal(normalizeMarket('Shots on Goal'), 'shotsOnGoal');
});

test('half-line model is deterministic, shrunk and computes edge only from supplied odds', () => {
  const values = [30, 28, 25, 24, 22, 21, 19, 18, 17, 15];
  const result = buildPlayerPropModel({
    sport: 'nba', market: 'points', side: 'over', line: 20.5,
    observations: values.map((value) => ({ value })), americanOdds: -110,
    source: 'official test fixture',
  });
  assert.equal(result.available, true);
  assert.equal(result.sampleSize, 10);
  assert.equal(result.wins, 6);
  assert.equal(result.probability, 0.571); // (6 + 2) / (10 + 4)
  assert.equal(result.impliedProbability, 0.524);
  assert.equal(result.estimatedEdge, 0.048);
  assert.equal(result.grade, 'C');
});

test('58-percent-plus mature estimates receive B grade consistently', () => {
  const values = [30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 10, 9, 8, 7, 6, 5, 4, 3];
  const result = buildPlayerPropModel({
    sport: 'nba', market: 'points', side: 'over', line: 18.5,
    observations: values.map((value) => ({ value })),
    source: 'official test fixture',
  });
  assert.equal(result.available, true);
  assert.equal(result.sampleSize, 20);
  assert.equal(result.wins, 12);
  assert.equal(result.probability, 0.583); // (12 + 2) / (20 + 4)
  assert.equal(result.grade, 'B');
});

test('integer lines model pushes separately', () => {
  const result = buildPlayerPropModel({
    sport: 'nhl', market: 'shots_on_goal', side: 'over', line: 3,
    observations: [4, 3, 2, 5, 3, 1, 4, 2].map((value) => ({ value })),
    source: 'official test fixture',
  });
  assert.equal(result.available, true);
  assert.equal(result.pushes, 2);
  assert.equal(result.pOver, 0.364); // Dirichlet: (3 + 1) / (8 + 3)
  assert.equal(result.pUnder, 0.364);
  assert.equal(result.pPush, 0.273);
});

test('mature sport-market calibration corrects historical overconfidence with a bounded adjustment', () => {
  const result = buildPlayerPropModel({
    sport: 'nba', market: 'points', side: 'over', line: 20.5,
    observations: [30, 28, 25, 24, 22, 21, 19, 18, 17, 15].map((value) => ({ value })),
    source: 'official test fixture',
    calibration: { n: 50, averageConfidence: 65, hitRate: 50 },
  });
  assert.equal(result.rawProbability, 0.571);
  assert.equal(result.probability, 0.496); // -7.5 pts: 15-point bias * 50/(50+50)
  assert.deepEqual(result.calibrationApplied, { n: 50, historicalBias: 0.15, adjustment: -0.075 });
});

test('insufficient or invalid history returns no probability', () => {
  const result = buildPlayerPropModel({
    sport: 'nfl', market: 'receiving_yards', side: 'over', line: 55.5,
    observations: [{ value: 70 }, { value: Number.NaN }, { value: 42 }], source: 'official test fixture',
  });
  assert.equal(result.available, false);
  assert.equal(result.sampleSize, 2);
  assert.equal(result.probability, undefined);
});

test('learning reports sport-market calibration separately and ignores ungraded legs', () => {
  const predictions: Prediction[] = [
    {
      prediction_id: 'nba-1', timestamp: '2026-01-01T00:00:00Z', sport: 'NBA', matchup: 'A vs B', bet_type: 'PROP', status: 'evaluated',
      legs: [{ leg_name: 'Player OVER 20.5 points', target_line: '20.5', market: 'points', model_probability: 0.6, model_version: 'empirical-beta-v1', outcome: 'won' }],
    },
    {
      prediction_id: 'nhl-1', timestamp: '2026-01-01T00:00:00Z', sport: 'NHL', matchup: 'C vs D', bet_type: 'PROP', status: 'needs_review',
      legs: [
        { leg_name: 'Skater OVER 2.5 shots', target_line: '2.5', market: 'shots_on_goal', model_probability: 0.55, model_version: 'empirical-beta-v1', outcome: 'lost' },
        { leg_name: 'Unknown prop', target_line: '', market: 'unknown', outcome: 'ungraded' },
      ],
    },
  ];
  const learning = buildLearningContext(predictions, new Date('2026-01-02T00:00:00Z'));
  assert.equal(learning.evaluated, 2);
  assert.equal(learning.perSportMarket?.['NBA:points']?.n, 1);
  assert.equal(learning.perSportMarket?.['NHL:shotsOnGoal']?.n, 1);
});

test('official ESPN stat rows grade supported NFL, NBA and NHL markets deterministically', () => {
  assert.deepEqual(
    evaluateEspnLegFromStats({ leg_name: 'QB OVER 249.5 passing yards', target_line: '249.5', market: 'passing_yards', side: 'over', line: 249.5 }, 'NFL', { passingYards: '276' }),
    { outcome: 'won', actual: 276 },
  );
  assert.deepEqual(
    evaluateEspnLegFromStats({ leg_name: 'Guard UNDER 7.5 assists', target_line: '7.5', market: 'assists', side: 'under', line: 7.5 }, 'NBA', { assists: '6' }),
    { outcome: 'won', actual: 6 },
  );
  assert.deepEqual(
    evaluateEspnLegFromStats({ leg_name: 'Goalie OVER 28.5 saves', target_line: '28.5', market: 'saves', side: 'over', line: 28.5 }, 'NHL', { saves: '31' }),
    { outcome: 'won', actual: 31 },
  );
  assert.equal(
    evaluateEspnLegFromStats({ leg_name: 'Skater OVER 2.5 fantasy score', target_line: '2.5', market: 'fantasy_score' }, 'NHL', {}).outcome,
    'ungraded',
  );
});
