import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ledgerKeysFromPicks,
  ledgerLegKey,
  ledgerTicketBatches,
  ledgerTicketKey,
  mergeSgpLegs,
  normalizeSgpLeg,
} from '../src/lib/slip.ts';

const first = {
  sport: 'NBA',
  game: 'TOR vs BOS',
  selection: 'Player One OVER 20.5 Points',
  market: 'points',
  line: 20.5,
  odds: 105,
};

test('successive SGP events append legs and refresh exact duplicates', () => {
  const next = mergeSgpLegs([first], [
    { ...first, odds: 110, confidence: 61 },
    { ...first, selection: 'Player Two OVER 5.5 Assists', market: 'assists', line: 5.5 },
  ]);
  assert.equal(next.length, 2);
  assert.equal(next[0]?.odds, 110);
  assert.equal(next[0]?.confidence, 61);
});

test('structured player and model provenance survives normalization', () => {
  const normalized = normalizeSgpLeg({
    ...first,
    entity_type: 'player',
    player_name: 'Player One',
    player_id: 'espn-123',
    team: 'TOR',
    side: 'over',
    model_probability: '61.4',
    model_version: 'nba-prop-v3',
    model_sample_size: 24,
    model_source: 'official-game-log-model',
    __gateNote: 'lineup checked at request time',
  });
  assert.equal(normalized?.player_name, 'Player One');
  assert.equal(normalized?.player_id, 'espn-123');
  assert.equal(normalized?.entity_type, 'player');
  assert.equal(normalized?.side, 'over');
  assert.equal(normalized?.model_probability, '61.4');
  assert.equal(normalized?.model_version, 'nba-prop-v3');
  assert.equal(normalized?.model_sample_size, 24);
  assert.equal(normalized?.model_source, 'official-game-log-model');
  assert.equal(normalized?.__gateNote, 'lineup checked at request time');
});

test('ledger tickets are deterministic and split at the API limit', () => {
  const legs = Array.from({ length: 58 }, (_, index) => ({ ...first, selection: `Player ${index}` }));
  assert.deepEqual(ledgerTicketBatches(legs).map((batch) => batch.length), [25, 25, 8]);
  const date = new Date('2026-08-16T16:00:00.000Z');
  assert.equal(
    ledgerTicketKey([legs[1], legs[0]], date),
    ledgerTicketKey([legs[0], legs[1]], date),
  );
});

test('durable ledger rows reconstruct the local tracked identity', () => {
  const createdAt = '2026-08-16T16:00:00.000Z';
  const keys = ledgerKeysFromPicks([{ ...first, createdAt }]);
  assert.deepEqual([...keys], [ledgerLegKey(first, new Date(createdAt))]);
  assert.equal(ledgerKeysFromPicks([{ ...first, createdAt: 'invalid' }]).size, 0);
});

test('official event identity survives midnight and distinguishes doubleheaders', () => {
  const official = { ...first, eventDate: '2026-08-20', eventId: 'game-1' };
  const nextGame = { ...official, eventId: 'game-2' };
  assert.equal(
    ledgerLegKey(official, new Date('2026-08-19T23:59:00.000Z')),
    ledgerLegKey(official, new Date('2026-08-21T00:01:00.000Z')),
  );
  assert.notEqual(ledgerLegKey(official), ledgerLegKey(nextGame));
  assert.deepEqual(
    [...ledgerKeysFromPicks([{ ...official, createdAt: 'invalid' }])],
    [ledgerLegKey(official)],
  );
});
