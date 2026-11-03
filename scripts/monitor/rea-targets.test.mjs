import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MAX_ANALYZED_BYTES, selectReaTargets } from './rea-targets.mjs';

test('partial REA scope excludes large Vite chunks and ignores non-JavaScript', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'sportsedge-rea-'));
  t.after(() => rm(root, { force: true, recursive: true }));
  await mkdir(join(root, 'assets'));
  await writeFile(join(root, 'index.html'), '<html></html>');
  await writeFile(join(root, 'assets', 'index-big.js'), Buffer.alloc(MAX_ANALYZED_BYTES + 1));
  await writeFile(join(root, 'assets', 'small.js'), 'const a=1');
  await writeFile(join(root, 'assets', 'other.js'), Buffer.alloc(MAX_ANALYZED_BYTES));
  await writeFile(join(root, 'assets', 'styles.css'), 'body{}');
  const result = await selectReaTargets(root);
  assert.equal(result.total, 3);
  assert.deepEqual(result.selected.map((file) => file.path), ['assets/other.js', 'assets/small.js']);
  assert.deepEqual(result.skipped.map((file) => file.path), ['assets/index-big.js']);
});
