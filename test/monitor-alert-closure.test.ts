import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('hourly smoke success cannot close an unresolved daily scanner alert', () => {
  const workflow = readFileSync(
    new URL('../.github/workflows/sportsedge-pilot-monitor.yml', import.meta.url),
    'utf8',
  );
  const closeStep = workflow
    .split('      - name: Close the monitoring issue after all checks recover\n')[1]
    ?.split('\n      - name: ')[0];

  assert.ok(closeStep, 'monitoring issue closure step must exist');
  const condition = closeStep.match(/^\s*if:\s*(.+)$/m)?.[1] ?? '';

  assert.match(condition, /steps\.smoke\.outcome == 'success'/);
  assert.match(condition, /steps\.proof\.outcome == 'success'/);
  assert.match(condition, /steps\.rea\.outcome == 'success'/);
  assert.doesNotMatch(condition, /skipped/, 'hourly runs skip scans and must not close scanner alerts');
});
