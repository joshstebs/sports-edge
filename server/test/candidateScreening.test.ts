import test from 'node:test';
import assert from 'node:assert/strict';
import { featureWindow } from '../src/candidates/featureProfile.js';
import { candidateCalibration, recordCandidateEvaluations, updateCandidateOutcome, loadCandidateHistory } from '../src/candidates/candidateHistory.js';
import { getToolSchemas } from '../src/llm/toolRegistry.js';
import { premiumProviderStatus } from '../src/providers/premiumAdapter.js';

test('feature windows preserve recent sample size and hit rate', () => {
  const result = featureWindow([3, 2, 1, 4, 0, 5], 1.5, 5);
  assert.deepEqual(result, { n: 5, average: 2, hitRateOverSuggestedLine: 0.6 });
});

test('universal slate screener is registered as an agent tool', () => {
  const names = getToolSchemas().map((tool) => tool.function.name);
  assert.ok(names.includes('slate_candidate_screener'));
});

test('candidate history calibrates every evaluated candidate, not only recommended picks', async () => {
  const base = {
    eventDate: '2099-01-01',
    eventId: 'test-event',
    sport: 'nba' as const,
    team: 'Test Team',
    opponent: 'Opponent',
    market: 'points',
    side: 'over' as const,
    line: 20.5,
    grade: 'B' as const,
    sampleSize: 20,
    modelVersion: 'empirical-beta-v1',
    modelSource: 'fixture',
    sources: ['fixture'],
    fallbackUsed: true,
  };
  await recordCandidateEvaluations([
    { ...base, player: 'Candidate Calibration A', modelProbability: 0.6 },
    { ...base, player: 'Candidate Calibration B', modelProbability: 0.7 },
  ]);
  const rows = (await loadCandidateHistory()).filter((row) => row.eventId === 'test-event');
  assert.equal(rows.length, 2);
  await updateCandidateOutcome(rows[0].id, { actual: 25, outcome: 'won' });
  await updateCandidateOutcome(rows[1].id, { actual: 18, outcome: 'lost' });
  const calibration = await candidateCalibration('nba', 'points');
  assert.equal(calibration.n, 2);
  assert.equal(calibration.hitRate, 50);
  assert.equal(calibration.averageConfidence, 65);
  assert.equal(calibration.calibrationError, 15);
});

test('premium feeds remain optional enrichments', () => {
  const statuses = premiumProviderStatus();
  assert.ok(statuses.some((provider) => provider.provider === 'sportradar'));
  assert.ok(statuses.every((provider) => Array.isArray(provider.sports) && provider.sports.length > 0));
});
