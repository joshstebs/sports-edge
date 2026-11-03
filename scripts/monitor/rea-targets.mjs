import { readdir, stat } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

// REA 6.8.0 stalled on the 454 KB Vite/React entry chunk. Analyze smaller
// chunks, and explicitly report excluded chunks as UNKNOWN coverage.
export const MAX_ANALYZED_BYTES = 100 * 1024;

export async function selectReaTargets(distDir, maxBytes = MAX_ANALYZED_BYTES) {
  const root = resolve(distDir);
  const assets = resolve(root, 'assets');
  const entries = await readdir(assets, { withFileTypes: true });
  const candidates = [];
  for (const item of entries) {
    if (!item.isFile() || !item.name.endsWith('.js')) continue;
    const fullPath = resolve(assets, item.name);
    const { size } = await stat(fullPath);
    candidates.push({ path: relative(root, fullPath).split(sep).join('/'), bytes: size });
  }
  candidates.sort((a, b) => a.path.localeCompare(b.path, 'en'));
  return {
    selected: candidates.filter((item) => item.bytes <= maxBytes),
    skipped: candidates.filter((item) => item.bytes > maxBytes),
    total: candidates.length,
  };
}

async function main() {
  const distDir = process.argv[2] || 'dist';
  const mode = process.argv[3] || '--json';
  if (!['--json', '--null'].includes(mode)) throw new Error('Use --json or --null');
  const result = await selectReaTargets(distDir);
  if (result.selected.length === 0) throw new Error('No eligible JS modules for partial REA scan');
  if (mode === '--null') {
    for (const item of result.selected) process.stdout.write(item.path + '\0');
  } else {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  }
  console.error('REA scope: ' + result.selected.length + '/' + result.total + ' JS files; ' + result.skipped.length + ' large files excluded.');
  for (const item of result.skipped) console.error('REA NOT COVERED: ' + item.path + ' (' + item.bytes + ' bytes).');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
