import assert from 'node:assert/strict';
import test from 'node:test';
import {
  learnedEvidenceGrade,
  normalizePrediction,
  playerNameForEvidence,
} from '../src/lib/predictionStore.js';

test('prediction normalization preserves explicit player_name for learning', () => {
  const prediction = normalizePrediction({
    prediction_id: 'test-player-name',
    timestamp: '2026-08-19T07:00:00.000Z',
    game_date: '2026-08-19',
    sport: 'MLB',
    matchup: 'Blue Jays vs Yankees',
    bet_type: 'PROP',
    legs: [{
      player_name: 'Vladimir Guerrero Jr.',
      leg_name: 'Vladimir Guerrero Jr. OVER 1.5 Total Bases',
      target_line: '1.5',
      market: 'total_bases',
      side: 'over',
      line: 1.5,
      model_probability: '62',
      model_source: 'statsapi.mlb.com official gameLog',
    }],
  });

  assert.equal(prediction.legs[0]?.player_name, 'Vladimir Guerrero Jr.');
  assert.equal(playerNameForEvidence(prediction.legs[0]), 'Vladimir Guerrero Jr.');
});

test('legacy prediction legs infer player name from directional selection', () => {
  assert.equal(
    playerNameForEvidence({ leg_name: 'Aaron Judge OVER 1.5 Total Bases' }),
    'Aaron Judge',
  );
});

test('legacy threshold-style selections infer player name', () => {
  assert.equal(
    playerNameForEvidence({ leg_name: 'Auston Matthews 3.5+ Shots on Goal' }),
    'Auston Matthews',
  );
});

test('learned evidence grades use the same thresholds as the live model', () => {
  assert.equal(learnedEvidenceGrade(0.65), 'A');
  assert.equal(learnedEvidenceGrade(0.64), 'B');
  assert.equal(learnedEvidenceGrade(0.58), 'B');
  assert.equal(learnedEvidenceGrade(0.57), 'C');
  assert.equal(learnedEvidenceGrade(0.50), 'C');
  assert.equal(learnedEvidenceGrade(0.49), 'D');
});
