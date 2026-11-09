import assert from 'node:assert/strict';
import test from 'node:test';
import { pruneStaleSlipLegs, slateDateKey } from '../src/lib/slip';

test('slateDateKey uses the official America/Toronto date', () => {
  assert.equal(slateDateKey(new Date('2026-11-10T03:00:00Z')), '2026-11-09');
});

test('prior-slate selections are dropped while today, future and undated legs stay', () => {
  const legs = [
    { selection: 'old', eventDate: '2026-11-08' },
    { selection: 'today', eventDate: '2026-11-09' },
    { selection: 'future', eventDate: '2026-11-10' },
    { selection: 'undated' },
  ];
  const kept = pruneStaleSlipLegs(legs, new Date('2026-11-09T18:00:00Z'));
  assert.deepEqual(kept.map((leg) => leg.selection), ['today', 'future', 'undated']);
});

test('a late-night Toronto timestamp still keeps that slate', () => {
  const kept = pruneStaleSlipLegs(
    [{ selection: 'late', eventDate: '2026-11-09' }],
    new Date('2026-11-10T03:30:00Z'),
  );
  assert.equal(kept.length, 1);
});
