import { readFile } from 'node:fs/promises';
import { getAllPredictions, type Prediction } from '../src/lib/predictionStore.js';
import { walkForwardReport } from '../src/lib/walkForward.js';

// Run against a private local JSON snapshot, or the configured prediction store.
// Never fetch new odds or change production state during this evaluation.
const input = process.argv[2];
const predictions: Prediction[] = input ? JSON.parse(await readFile(input, 'utf8')) : await getAllPredictions();
if (!Array.isArray(predictions)) throw new Error('Expected a JSON array of prediction records');
console.log(JSON.stringify(walkForwardReport(predictions), null, 2));
