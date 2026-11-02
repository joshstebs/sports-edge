import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

for (const [label, path] of [
  ['frontend lockfile', '../../package-lock.json'],
  ['server lockfile', '../package-lock.json'],
] as const) {
  test(label + ' pins patched body-parser and its npm integrity', () => {
    const lock = JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as {
      packages: Record<string, { version: string; resolved?: string; integrity?: string; dependencies?: Record<string, string> }>;
    };
    const parser = lock.packages['node_modules/body-parser'];
    assert.ok(parser, 'body-parser dependency missing');
    assert.equal(parser.version, '2.4.0');
    assert.equal(parser.resolved, 'https://registry.npmjs.org/body-parser/-/body-parser-2.4.0.tgz');
    assert.equal(parser.integrity, 'sha512-Ifk1KcLrxaGt1occQagQNFNNOqRt1LFuehEnHHzB8Z6cRgIxRU1TBaiIsUiCdA+gy5PL7Y1IX31DNKkRmxtXjQ==');
    assert.equal(parser.dependencies?.['iconv-lite'], '^0.7.3');
    assert.equal(parser.dependencies?.qs, '^6.16.1');
  });
}
