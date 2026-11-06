import assert from 'node:assert/strict';
import test from 'node:test';
import { applyModelEvidence, canPersistPredictionLeg, recommendationSummary } from '../src/routes/chat.js';
import type { ModelEvidence } from '../src/lib/predictionStore.js';

test('a recommendation uses only evidence from its exact game and date', () => {
  const previous = process.env.EVIDENCE_GATE;
  process.env.EVIDENCE_GATE = 'strict';
  try {
    const leg = { player_name: 'Example Player', selection: 'Example Player over 20.5 points', market: 'points', side: 'over', line: 20.5 };
    const row: ModelEvidence = { player: 'Example Player', sport: 'nba', market: 'points', side: 'over', line: 20.5,
      probability: 0.71, grade: 'B', estimatedEdge: 0.08, modelVersion: 'live-model', sampleSize: 10,
      source: 'official', eventDate: '2026-11-06', eventId: 'game-2' };
    const context = { date: '2026-11-06', eventId: 'game-2' };
    const historic = { ...row, probability: 0.99, modelVersion: 'historical', eventDate: '', eventId: '' };
    const wrongGame = { ...row, probability: 0.98, eventId: 'game-1' };
    const wrongDate = { ...row, probability: 0.97, eventDate: '2026-11-05' };
    const matched = applyModelEvidence([leg], 'nba', [historic, wrongGame, wrongDate, row], context);
    assert.equal(matched.legs.length, 1);
    assert.equal(matched.legs[0].model_version, 'live-model');
    assert.equal(matched.legs[0].model_probability, '71');
    assert.equal(matched.legs[0].__matchedPlayerModel, true);
    for (const candidates of [[historic], [wrongGame], [wrongDate], []]) {
      const rejected = applyModelEvidence([leg], 'nba', candidates, context);
      assert.equal(rejected.legs.length, 0);
      assert.equal(rejected.blocked.length, 1);
    }
    assert.equal(applyModelEvidence([leg], 'nba', [row], { date: context.date }).legs.length, 0);
    assert.equal(applyModelEvidence([leg], 'nba', [row], { eventId: context.eventId }).legs.length, 0);
    assert.equal(applyModelEvidence([{ ...leg, eventDate: context.date, eventId: context.eventId }], 'nba', [row]).legs[0].model_probability, '71');
    process.env.EVIDENCE_GATE = 'relaxed';
    const analysisOnly = applyModelEvidence([leg], 'nba', [historic, wrongGame], context);
    assert.equal(analysisOnly.legs.length, 1);
    assert.equal(analysisOnly.legs[0].model_version, undefined);
    assert.equal(analysisOnly.legs[0].__matchedPlayerModel, false);
    const untrusted = applyModelEvidence([{ ...leg, __matchedPlayerModel: true }], 'nba', [], context);
    assert.equal(untrusted.legs[0].__matchedPlayerModel, false, 'Model-authored flags cannot claim verification');
  } finally {
    if (previous === undefined) delete process.env.EVIDENCE_GATE;
    else process.env.EVIDENCE_GATE = previous;
  }
});

test('summary clearly labels player selections without server-matched model evidence', () => {
  assert.match(recommendationSummary([{ player_name: 'Player A', __matchedPlayerModel: false }]), /analysis only/);
  assert.doesNotMatch(recommendationSummary([{ player_name: 'Player A', __matchedPlayerModel: true }]), /analysis only/);
  assert.doesNotMatch(recommendationSummary([{ entity_type: 'game', selection: 'Game total over 8.5' }]), /player selection lacks/);
  assert.doesNotMatch(recommendationSummary([{ player_name: 'Player A' }]), /Verified recommendation/);
  assert.equal(canPersistPredictionLeg({ player_name: 'Player A', __matchedPlayerModel: false }), false);
  assert.equal(canPersistPredictionLeg({ player_name: 'Player A', __matchedPlayerModel: true }), true);
  assert.equal(canPersistPredictionLeg({ entity_type: 'game', selection: 'Game total over 8.5' }), true);
});
