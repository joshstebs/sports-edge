import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('local prediction storage fails closed on corrupt JSON instead of overwriting history', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'sports-edge-corrupt-'));
  process.env.SPORTS_EDGE_DATA_DIR = directory;
  try {
    await fs.writeFile(path.join(directory, 'predictions.json'), '{broken-json', 'utf8');
    const store = await import('../src/lib/predictionStore.js');
    await assert.rejects(() => store.getAllPredictions(), SyntaxError);
    await assert.rejects(() => store.addPrediction(store.normalizePrediction({
      timestamp: new Date().toISOString(), sport: 'MLB', matchup: 'A vs B', bet_type: 'PROP',
      legs: [{ leg_name: 'Test Player Over 1.5 Hits', target_line: '1.5' }],
    })), SyntaxError);
    assert.equal(await fs.readFile(path.join(directory, 'predictions.json'), 'utf8'), '{broken-json');
  } finally {
    delete process.env.SPORTS_EDGE_DATA_DIR;
    await fs.rm(directory, { recursive: true, force: true });
  }
});
