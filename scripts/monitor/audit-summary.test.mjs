import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeAudit } from './audit-summary.mjs';

test('npm audit summary names packages and preserves severity', () => {
  const result = summarizeAudit({
    metadata: { vulnerabilities: { critical: 0, high: 1, moderate: 0, low: 0 } },
    vulnerabilities: { example: { severity: 'high', range: '<2', isDirect: false, fixAvailable: true } },
  });
  assert.equal(result.findings.length, 1);
  assert.deepEqual(result.findings[0], { name: 'example', severity: 'high', range: '<2', isDirect: false, fixAvailable: true });
});

test('npm audit rejects provider error JSON rather than reporting clean', () => {
  assert.throws(() => summarizeAudit({ error: { code: 'ENOAUDIT' } }), /valid vulnerability report/);
});
