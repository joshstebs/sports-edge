import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workflow = readFileSync(new URL('../../.github/workflows/sportsedge-pilot-monitor.yml', import.meta.url), 'utf8');

test('PR-branch monitor runs cannot create or close master health alerts', () => {
  const open = workflow.match(/- name: Open one GitHub issue when a check fails\n\s+if: (.+)/);
  const close = workflow.match(/- name: Close the monitoring issue after all checks recover\n\s+if: (.+)/);
  assert.ok(open, 'open-issue condition exists');
  assert.ok(close, 'close-issue condition exists');
  for (const condition of [open[1], close[1]]) {
    assert.match(condition, /github\.ref == 'refs\/heads\/master'/);
  }
  for (const id of ['smoke', 'proof', 'rea', 'audit']) {
    assert.match(close[1], new RegExp("steps\\." + id + "\\.outcome == 'success'"));
  }
  assert.doesNotMatch(close[1], /skipped/);
});
