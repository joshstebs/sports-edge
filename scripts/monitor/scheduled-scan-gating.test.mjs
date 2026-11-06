import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(
  new URL('../../.github/workflows/sportsedge-pilot-monitor.yml', import.meta.url),
  'utf8',
);

test('each security scan runs on any delivered schedule event or manual dispatch', () => {
  const steps = [
    'Scan the built frontend for exposed data (scheduled or manual)',
    'Identify dependency advisories (scheduled or manual)',
    'Analyze scoped JavaScript with REA (scheduled or manual)',
  ];
  for (const name of steps) {
    const marker = '      - name: ' + name + '\n';
    const section = workflow.split(marker)[1]?.split('\n      - name: ')[0];
    assert.ok(section, 'Missing scan step: ' + name);
    assert.match(
      section,
      /if: \$\{\{ github\.event_name == 'workflow_dispatch' \|\| github\.event_name == 'schedule' \}\}/,
      'Scheduled runs must not silently skip ' + name,
    );
  }
});

test('hourly and daily schedules remain configured for trigger redundancy', () => {
  assert.match(workflow, /cron: '11 \* \* \* \*'/);
  assert.match(workflow, /cron: '37 4 \* \* \*'/);
});
