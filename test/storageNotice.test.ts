import assert from 'node:assert/strict';
import test from 'node:test';
import { ledgerSourceStatus, storageNoticeForHealth } from '../src/lib/api';

test('durable storage produces no warning', () => {
  const health = { ok: true, sources: { ledger: { available: true, backend: 'upstash-redis', durable: true } } };
  assert.equal(storageNoticeForHealth(health), null);
  assert.deepEqual(ledgerSourceStatus(health), { available: true, backend: 'upstash-redis', durable: true });
});

test('an unconfigured preview surfaces an honest browser-only warning', () => {
  const health = { ok: true, sources: { ledger: { available: false, backend: 'not-configured', durable: false } } };
  const notice = storageNoticeForHealth(health);
  assert.ok(notice);
  assert.match(notice!, /not configured/);
  assert.match(notice!, /stay in this browser/);
  assert.match(notice!, /not saved to the results ledger/);
});

test('health without a ledger source stays silent', () => {
  assert.equal(storageNoticeForHealth({ ok: true }), null);
  assert.equal(storageNoticeForHealth(null), null);
});
