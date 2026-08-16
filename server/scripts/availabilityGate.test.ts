import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyModelEvidence,
  isClearlyNonPlayerLeg,
  parseAmericanOdds,
} from '../src/routes/chat.js';
import {
  playerFromSelection,
  verifyRecommendationAvailability,
} from '../src/providers/playerAvailability.js';
import { getGameDayStatus } from '../src/providers/espn.js';

test('explicit entity_type is the only non-player bypass', () => {
  assert.equal(isClearlyNonPlayerLeg({ entity_type: 'team', selection: 'Blue Jays team total OVER 4.5' }), true);
  assert.equal(isClearlyNonPlayerLeg({ entity_type: 'game', selection: 'Game total OVER 8.5' }), true);
  assert.equal(isClearlyNonPlayerLeg({ market: 'total', selection: 'LeBron James 25+ points' }), false);
  assert.equal(isClearlyNonPlayerLeg({ entity_type: 'team', player_name: 'LeBron James' }), false);
  assert.equal(isClearlyNonPlayerLeg({ entity_type: 'game', player_id: 123 }), false);
});

test('player parser and model evidence match the exact normalized prop', () => {
  assert.equal(playerFromSelection('Shohei Ohtani OVER 1.5 Total Bases'), 'Shohei Ohtani');
  const evidence = [{
    player: 'Shohei Ohtani', sport: 'mlb', market: 'totalBases', side: 'over', line: 1.5,
    probability: 0.624, grade: 'B', estimatedEdge: 0.08,
    modelVersion: 'empirical-beta-v1', sampleSize: 20, source: 'official game log',
    eventDate: '2026-08-20', eventId: '12345',
  }];
  const accepted = applyModelEvidence([{
    entity_type: 'player', player_name: 'Shohei Ohtani', sport: 'MLB',
    selection: 'Shohei Ohtani OVER 1.5 Total Bases', market: 'total_bases', side: 'over', line: 1.5,
  }], 'MLB', evidence, { date: '2026-08-20', eventId: '12345' });
  assert.equal(accepted.blocked.length, 0);
  assert.equal(accepted.legs[0].model_version, 'empirical-beta-v1');
  assert.equal(accepted.legs[0].model_probability, '62.4');

  const wrongLine = applyModelEvidence([{
    entity_type: 'player', player_name: 'Shohei Ohtani', sport: 'MLB',
    selection: 'Shohei Ohtani OVER 2.5 Total Bases', market: 'total_bases', side: 'over', line: 2.5,
  }], 'MLB', evidence, { date: '2026-08-20', eventId: '12345' });
  assert.equal(wrongLine.legs.length, 0);
  assert.equal(wrongLine.blocked.length, 1);

  const mismatchedName = applyModelEvidence([{
    entity_type: 'player', player_name: 'Shohei Ohtani', sport: 'MLB',
    selection: 'Aaron Judge OVER 1.5 Total Bases', market: 'total_bases', side: 'over', line: 1.5,
  }], 'MLB', evidence, { date: '2026-08-20', eventId: '12345' });
  assert.equal(mismatchedName.legs.length, 0, 'explicit player_name cannot contradict the displayed selection');

  const wrongEvent = applyModelEvidence([{
    entity_type: 'player', player_name: 'Shohei Ohtani', sport: 'MLB',
    selection: 'Shohei Ohtani OVER 1.5 Total Bases', market: 'total_bases', side: 'over', line: 1.5,
  }], 'MLB', evidence, { date: '2026-08-20', eventId: '99999' });
  assert.equal(wrongEvent.legs.length, 0, 'model evidence is scoped to one exact event');
});

test('American odds fallback accepts signed prices only', () => {
  assert.equal(parseAmericanOdds('+110'), 110);
  assert.equal(parseAmericanOdds('-105'), -105);
  assert.equal(parseAmericanOdds('−120'), -120);
  assert.equal(parseAmericanOdds('even'), null);
  assert.equal(parseAmericanOdds(0), null);
});

test('invalid or unsupported availability context fails closed without a network call', async () => {
  const unsupported = await verifyRecommendationAvailability({ player: 'Test Player', sport: 'soccer', date: '2026-08-16' });
  assert.equal(unsupported.recommendationEligible, false);
  assert.equal(unsupported.statusVerified, false);

  const badDate = await getGameDayStatus('football/nfl', 'Test Player', '1', 'not-a-date', null);
  assert.equal(badDate.available, false);
});
