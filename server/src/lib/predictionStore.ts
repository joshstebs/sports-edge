// Prediction log store — the self-learning ledger.
// JSON-file storage (zero deps, atomic writes). Every [PREDICTION_LOG] block
// from the analyst is stored here with status pending, evaluated next day
// against official box scores (scripts/evaluate.ts), and the resulting hit
// rates feed back into the system prompt as adaptive learning context.

import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.join(process.cwd(), 'data');
const FILE = path.join(DATA_DIR, 'predictions.json');
const LEARN_FILE = path.join(DATA_DIR, 'learning.json');

export interface PredictionLeg {
  leg_name: string;
  target_line: string;
  model_probability?: string | null;
  implied_odds?: string | number | null;
  key_metric_used?: string | null;
  // evaluation results:
  outcome?: 'won' | 'lost' | 'push' | null;
  actual?: number | null;
}

export interface Prediction {
  prediction_id: string;
  timestamp: string;
  sport: string;
  matchup: string;
  bet_type: string;
  legs: PredictionLeg[];
  recommended_units?: string | null;
  gameDate?: string | null; // set at evaluation time
  status: 'pending' | 'evaluated';
}

interface StoreFile {
  predictions: Prediction[];
}

export interface LearningContext {
  updatedAt: string;
  evaluated: number;
  hitRate: number | null;
  roi: number | null;
  perMarket: Record<string, { n: number; hitRate: number }>;
  adaptiveRules: string[];
}

function load(): StoreFile {
  try {
    const raw = fs.readFileSync(FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.predictions)) return parsed;
  } catch {
    // missing/corrupt — fresh
  }
  return { predictions: [] };
}

function save(file: StoreFile): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(file, null, 2), 'utf8');
  fs.renameSync(tmp, FILE);
}

export function addPrediction(pred: Prediction): Prediction {
  const file = load();
  if (file.predictions.some((p) => p.prediction_id === pred.prediction_id)) {
    return pred; // dedupe
  }
  file.predictions.push(pred);
  save(file);
  return pred;
}

export function listPredictions(): { predictions: Prediction[]; summary: any } {
  const file = load();
  const pending = file.predictions.filter((p) => p.status === 'pending').length;
  const evaluated = file.predictions.filter((p) => p.status === 'evaluated').length;
  return { predictions: file.predictions, summary: { total: file.predictions.length, pending, evaluated } };
}

export function getPendingPredictions(): Prediction[] {
  return load().predictions.filter((p) => p.status === 'pending');
}

export function updatePrediction(id: string, patch: Partial<Prediction>): Prediction | null {
  const file = load();
  const pred = file.predictions.find((p) => p.prediction_id === id);
  if (!pred) return null;
  Object.assign(pred, patch);
  save(file);
  return pred;
}

export function loadLearning(): LearningContext | null {
  try {
    const raw = fs.readFileSync(LEARN_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {
    // none yet
  }
  return null;
}

export function saveLearning(ctx: LearningContext): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${LEARN_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(ctx, null, 2), 'utf8');
  fs.renameSync(tmp, LEARN_FILE);
}

/** Human-readable learning section injected into the system prompt at chat time. */
export function learningPromptBlock(): string {
  const ctx = loadLearning();
  if (!ctx || !ctx.evaluated) return '';
  const lines = [
    '### ADAPTIVE LEARNING CONTEXT (from your own tracked predictions — update your prior probabilities with this evidence):',
    `Your last ${ctx.evaluated} logged picks (all real box-score results): overall hit rate ${ctx.hitRate ?? 'n/a'}%, flat-1u ROI ${ctx.roi ?? 'n/a'}%.`,
  ];
  const markets = Object.entries(ctx.perMarket)
    .map(([m, v]) => `${m}: ${v.n} picks, ${v.hitRate}% hit rate`)
    .join('; ');
  if (markets) lines.push(`Per-market calibration: ${markets}.`);
  for (const rule of ctx.adaptiveRules ?? []) lines.push(`- Learning rule: ${rule}`);
  lines.push(
    'Adjust your confidence grades and P(over) estimates toward the empirical evidence where your hit rate deviates from your stated probability.'
  );
  return lines.join('\n');
}
