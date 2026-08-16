// Durable prediction/learning store. Development uses atomic JSON files.
// Production can use Upstash Redis REST via UPSTASH_REDIS_REST_URL/TOKEN.

import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const DATA_DIR = process.env.SPORTS_EDGE_DATA_DIR
  ? path.resolve(process.env.SPORTS_EDGE_DATA_DIR)
  : process.env.VERCEL ? path.join('/tmp', 'sports-edge-data') : path.join(process.cwd(), 'data');
const FILE = path.join(DATA_DIR, 'predictions.json');
const LEARN_FILE = path.join(DATA_DIR, 'learning.json');
const REDIS_PREFIX = process.env.SPORTS_EDGE_REDIS_PREFIX || 'sports-edge';
const PREDICTIONS_KEY = `${REDIS_PREFIX}:predictions`;
const LEARNING_KEY = `${REDIS_PREFIX}:learning`;

export type LegOutcome = 'won' | 'lost' | 'push' | 'ungraded';

export interface PredictionLeg {
  leg_name: string;
  target_line: string;
  model_probability?: string | number | null;
  implied_odds?: string | number | null;
  key_metric_used?: string | null;
  market?: string | null;
  player_id?: string | number | null;
  side?: 'over' | 'under' | null;
  line?: number | null;
  model_version?: string | null;
  model_sample_size?: number | null;
  model_source?: string | null;
  outcome?: LegOutcome | null;
  actual?: number | null;
  evaluation_note?: string | null;
  evaluated_at?: string | null;
}

export interface Prediction {
  prediction_id: string;
  userId?: string;
  source_prediction_id?: string | null;
  timestamp: string;
  sport: string;
  matchup: string;
  bet_type: string;
  legs: PredictionLeg[];
  recommended_units?: string | null;
  gameDate?: string | null;
  gamePk?: number | null;
  event_id?: string | number | null;
  status: 'pending' | 'evaluated' | 'needs_review';
  evaluationNote?: string | null;
  evaluatedAt?: string | null;
  evaluationAttempts?: number;
  lastEvaluationAttemptAt?: string | null;
}

interface StoreFile { predictions: Prediction[] }

export interface MarketLearning {
  n: number;
  hitRate: number;
  averageConfidence?: number | null;
  calibrationError?: number | null;
  brierScore?: number | null;
}

export interface LearningContext {
  updatedAt: string;
  evaluated: number;
  won?: number;
  lost?: number;
  pushes?: number;
  priced?: number;
  hitRate: number | null;
  roi: number | null;
  brierScore?: number | null;
  perMarket: Record<string, MarketLearning>;
  perSportMarket?: Record<string, MarketLearning>;
  adaptiveRules: string[];
}

interface StorageAdapter {
  loadPredictions(): Promise<StoreFile>;
  addPrediction(prediction: Prediction): Promise<Prediction>;
  updatePrediction(id: string, patch: Partial<Prediction>): Promise<Prediction | null>;
  loadLearning(): Promise<LearningContext | null>;
  saveLearning(context: LearningContext): Promise<void>;
}

export function redisConfigured(): boolean {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

async function atomicWrite(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
  await fs.rename(tmp, file);
}

async function loadJson<T>(file: string, fallback: T): Promise<T> {
  try { return JSON.parse(await fs.readFile(file, 'utf8')) as T; }
  catch { return fallback; }
}

let localPredictionMutationTail = Promise.resolve();
function withLocalPredictionMutation<T>(operation: () => Promise<T>): Promise<T> {
  const run = localPredictionMutationTail.then(operation, operation);
  localPredictionMutationTail = run.then(() => undefined, () => undefined);
  return run;
}

class FileStorage implements StorageAdapter {
  async loadPredictions(): Promise<StoreFile> {
    const value = await loadJson<StoreFile>(FILE, { predictions: [] });
    return value && Array.isArray(value.predictions) ? value : { predictions: [] };
  }
  async addPrediction(prediction: Prediction): Promise<Prediction> {
    return withLocalPredictionMutation(async () => {
      const file = await this.loadPredictions();
      const existing = file.predictions.find((p) => p.prediction_id === prediction.prediction_id);
      if (existing) return existing;
      file.predictions.push(prediction);
      await atomicWrite(FILE, file);
      return prediction;
    });
  }
  async updatePrediction(id: string, patch: Partial<Prediction>): Promise<Prediction | null> {
    return withLocalPredictionMutation(async () => {
      const file = await this.loadPredictions();
      const prediction = file.predictions.find((p) => p.prediction_id === id);
      if (!prediction) return null;
      Object.assign(prediction, patch);
      await atomicWrite(FILE, file);
      return prediction;
    });
  }
  loadLearning(): Promise<LearningContext | null> { return loadJson<LearningContext | null>(LEARN_FILE, null); }
  saveLearning(context: LearningContext): Promise<void> { return atomicWrite(LEARN_FILE, context); }
}

export async function redisCommand<T>(command: Array<string | number>): Promise<T> {
  const base = process.env.UPSTASH_REDIS_REST_URL?.replace(/\/$/, '');
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!base || !token) throw new Error('Upstash Redis REST is not configured');
  const response = await fetch(base, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command), signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Upstash Redis error: HTTP ${response.status}`);
  const payload = (await response.json()) as { result?: T; error?: string };
  if (payload.error) throw new Error(`Upstash Redis error: ${payload.error}`);
  return payload.result as T;
}

const ADD_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
local doc = raw and cjson.decode(raw) or {predictions={}}
local incoming = cjson.decode(ARGV[1])
for _, p in ipairs(doc.predictions) do
  if p.prediction_id == incoming.prediction_id then return cjson.encode(p) end
end
table.insert(doc.predictions, incoming)
redis.call('SET', KEYS[1], cjson.encode(doc))
return cjson.encode(incoming)`;

const UPDATE_SCRIPT = `
local raw = redis.call('GET', KEYS[1])
if not raw then return nil end
local doc = cjson.decode(raw)
local patch = cjson.decode(ARGV[2])
for _, p in ipairs(doc.predictions or {}) do
  if p.prediction_id == ARGV[1] then
    for k, v in pairs(patch) do p[k] = v end
    redis.call('SET', KEYS[1], cjson.encode(doc))
    return cjson.encode(p)
  end
end
return nil`;

class RedisStorage implements StorageAdapter {
  async loadPredictions(): Promise<StoreFile> {
    const raw = await redisCommand<string | null>(['GET', PREDICTIONS_KEY]);
    if (!raw) return { predictions: [] };
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.predictions)) throw new Error('Stored prediction history is corrupt');
    return parsed;
  }
  async addPrediction(prediction: Prediction): Promise<Prediction> {
    const raw = await redisCommand<string>(['EVAL', ADD_SCRIPT, 1, PREDICTIONS_KEY, JSON.stringify(prediction)]);
    return JSON.parse(raw) as Prediction;
  }
  async updatePrediction(id: string, patch: Partial<Prediction>): Promise<Prediction | null> {
    const raw = await redisCommand<string | null>(['EVAL', UPDATE_SCRIPT, 1, PREDICTIONS_KEY, id, JSON.stringify(patch)]);
    return raw ? JSON.parse(raw) as Prediction : null;
  }
  async loadLearning(): Promise<LearningContext | null> {
    const raw = await redisCommand<string | null>(['GET', LEARNING_KEY]);
    return raw ? JSON.parse(raw) as LearningContext : null;
  }
  async saveLearning(context: LearningContext): Promise<void> {
    await redisCommand<string>(['SET', LEARNING_KEY, JSON.stringify(context)]);
  }
}

export class StorageNotConfiguredError extends Error {
  code = 'STORAGE_NOT_CONFIGURED' as const;
  constructor() {
    super('Durable prediction storage is not configured. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN.');
  }
}

class UnconfiguredProductionStorage implements StorageAdapter {
  private fail(): never { throw new StorageNotConfiguredError(); }
  loadPredictions(): Promise<StoreFile> { return Promise.reject(this.fail()); }
  addPrediction(): Promise<Prediction> { return Promise.reject(this.fail()); }
  updatePrediction(): Promise<Prediction | null> { return Promise.reject(this.fail()); }
  // Chat can still answer when learning is unavailable, but all stateful APIs
  // and writes fail closed instead of pretending /tmp is durable.
  loadLearning(): Promise<LearningContext | null> { return Promise.resolve(null); }
  saveLearning(): Promise<void> { return Promise.reject(this.fail()); }
}

const storage: StorageAdapter = redisConfigured()
  ? new RedisStorage()
  : process.env.VERCEL ? new UnconfiguredProductionStorage() : new FileStorage();

function validDate(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  return /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(Date.parse(`${text}T12:00:00Z`)) ? text : null;
}

function safeTimestamp(value: unknown): string {
  const parsed = new Date(typeof value === 'string' ? value : '');
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function optionalNumber(value: unknown): number | null {
  if (value == null || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function predictionFingerprint(prediction: Omit<Prediction, 'prediction_id'>): string {
  const stable = JSON.stringify({
    userId: prediction.userId ?? 'admin', date: prediction.timestamp.slice(0, 10), gameDate: prediction.gameDate, sport: prediction.sport, matchup: prediction.matchup,
    bet_type: prediction.bet_type,
    legs: prediction.legs.map((leg) => ({ leg_name: leg.leg_name, target_line: leg.target_line, implied_odds: leg.implied_odds ?? null })),
  });
  return createHash('sha256').update(stable).digest('hex').slice(0, 10);
}

export function normalizePrediction(input: any): Prediction {
  const timestamp = safeTimestamp(input?.timestamp);
  const sourceId = (String(input?.prediction_id ?? `prediction-${Date.now()}`).trim() || `prediction-${Date.now()}`).slice(0, 120);
  const legs: PredictionLeg[] = (Array.isArray(input?.legs) ? input.legs : [])
    .filter((leg: any) => leg && typeof leg.leg_name === 'string' && leg.leg_name.trim())
    .map((leg: any) => ({
      leg_name: leg.leg_name.trim().slice(0, 300), target_line: String(leg.target_line ?? '').trim().slice(0, 40),
      model_probability: leg.model_probability ?? null, implied_odds: leg.implied_odds ?? null,
      key_metric_used: leg.key_metric_used != null ? String(leg.key_metric_used).slice(0, 100) : null,
      market: leg.market != null ? String(leg.market).slice(0, 80) : null, player_id: leg.player_id ?? null,
      side: /^(over|under)$/i.test(String(leg.side ?? '')) ? String(leg.side).toLowerCase() as 'over' | 'under' : null,
      line: optionalNumber(leg.line),
      model_version: leg.model_version != null ? String(leg.model_version).slice(0, 80) : null,
      model_sample_size: optionalNumber(leg.model_sample_size),
      model_source: leg.model_source != null ? String(leg.model_source).slice(0, 200) : null,
    }));
  const base: Omit<Prediction, 'prediction_id'> = {
    source_prediction_id: sourceId, timestamp,
    userId: typeof input?.userId === 'string' && input.userId.trim() ? input.userId.trim().slice(0, 120) : 'admin',
    sport: String(input?.sport ?? 'MLB').trim().toUpperCase().slice(0, 20),
    matchup: String(input?.matchup ?? '').trim().slice(0, 200),
    bet_type: String(input?.bet_type ?? 'PROP').trim().toUpperCase().slice(0, 40), legs,
    recommended_units: input?.recommended_units != null ? String(input.recommended_units).slice(0, 20) : null,
    gameDate: validDate(input?.game_date ?? input?.gameDate),
    gamePk: Number.isInteger(optionalNumber(input?.gamePk)) ? optionalNumber(input.gamePk) : null, status: 'pending',
    event_id: input?.event_id ?? input?.game_id ?? null, evaluationAttempts: 0, lastEvaluationAttemptAt: null,
  };
  // Content suffix: exact retries are idempotent; reused model IDs cannot drop a different pick.
  return { ...base, prediction_id: `${sourceId}-${predictionFingerprint(base)}` };
}

export async function addPrediction(input: Prediction | any): Promise<Prediction> {
  const prediction = normalizePrediction(input);
  if (!prediction.legs.length) throw new Error('Prediction must contain at least one valid leg');
  return storage.addPrediction(prediction);
}

export async function listPredictions(userId?: string): Promise<{ predictions: Prediction[]; summary: Record<string, number> }> {
  const all = (await storage.loadPredictions()).predictions;
  const predictions = userId ? all.filter((prediction) => (prediction.userId ?? 'admin') === userId) : all;
  return { predictions, summary: {
    total: predictions.length, pending: predictions.filter((p) => p.status === 'pending').length,
    evaluated: predictions.filter((p) => p.status === 'evaluated').length,
    needsReview: predictions.filter((p) => p.status === 'needs_review').length,
  } };
}

export async function getPendingPredictions(): Promise<Prediction[]> {
  return (await storage.loadPredictions()).predictions.filter((p) => p.status === 'pending');
}
export async function getAllPredictions(): Promise<Prediction[]> { return (await storage.loadPredictions()).predictions; }
export function updatePrediction(id: string, patch: Partial<Prediction>): Promise<Prediction | null> { return storage.updatePrediction(id, patch); }
export function loadLearning(): Promise<LearningContext | null> { return storage.loadLearning(); }
export function saveLearning(context: LearningContext): Promise<void> { return storage.saveLearning(context); }

export function storageStatus(): { backend: 'upstash-redis' | 'local-json' | 'not-configured'; durable: boolean; dataDir?: string } {
  if (redisConfigured()) return { backend: 'upstash-redis', durable: true };
  if (process.env.VERCEL) return { backend: 'not-configured', durable: false };
  return { backend: 'local-json', durable: true, dataDir: DATA_DIR };
}

export async function learningPromptBlock(): Promise<string> {
  const context = await loadLearning();
  if (!context || !context.evaluated) return '';
  const lines = [
    '\n### ADAPTIVE LEARNING CONTEXT (historical, settled predictions only):',
    `${context.evaluated} graded legs: ${context.won ?? 'n/a'} won, ${context.lost ?? 'n/a'} lost, ${context.pushes ?? 0} pushes; hit rate ${context.hitRate ?? 'n/a'}%.`,
    `Flat-1u ROI is ${context.roi ?? 'n/a'}% across ${context.priced ?? 'n/a'} legs with verified odds.${context.brierScore != null ? ` Probability Brier score: ${context.brierScore}.` : ''}`,
  ];
  const markets = Object.entries(context.perMarket ?? {}).map(([market, value]) => {
    const calibration = value.averageConfidence != null ? `, stated ${value.averageConfidence}% (error ${value.calibrationError ?? 'n/a'} pts)` : '';
    return `${market}: n=${value.n}, hit ${value.hitRate}%${calibration}`;
  }).join('; ');
  if (markets) lines.push(`Market calibration: ${markets}.`);
  const sportMarkets = Object.entries(context.perSportMarket ?? {}).map(([key, value]) =>
    `${key}: n=${value.n}, hit ${value.hitRate}%${value.averageConfidence != null ? `, stated ${value.averageConfidence}%` : ''}`
  ).join('; ');
  if (sportMarkets) lines.push(`Sport-specific calibration: ${sportMarkets}.`);
  for (const rule of context.adaptiveRules ?? []) lines.push(`- ${rule}`);
  lines.push('Use this as calibration evidence, not as permission to invent an edge. Small samples must not be treated as proof of predictive skill.');
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Learned per-leg evidence: aggregates EVALUATED predictions by
// (sport, player, market, side, line) — i.e. what the engine learned by
// comparing past nights' picks against actual results — and turns it into
// ModelEvidence rows that the chat pipeline can enrich live recommendations
// with. Rows with fewer than MIN_SAMPLES legs are not emitted (too little
// data to claim a verified edge), and D-grade rows are emitted as-is so the
// strict gate can withhold them while the relaxed gate ignores them.
// ---------------------------------------------------------------------------
export interface ModelEvidence {
  player: string;
  sport: string;
  market: string;
  side: string;
  line: number | null;
  probability: number;
  grade: string;
  estimatedEdge: number | null;
  modelVersion: string;
  sampleSize: number;
  source: string;
  eventDate: string;
  eventId: string;
}

const EVIDENCE_MIN_SAMPLES = 5;

function evidenceKey(sport: string, player: string, market: string, side: string, line: number | null): string {
  return `${sport}|${player.toLowerCase().replace(/\s+/g, ' ').trim()}|${market.toLowerCase()}|${side}|${line ?? ''}`;
}

function evidenceAmericanToDecimal(american: number | null): number | null {
  if (american == null || !Number.isFinite(american)) return null;
  return american > 0 ? american / 100 + 1 : 100 / Math.abs(american) + 1;
}

export async function loadModelEvidence(): Promise<ModelEvidence[]> {
  try {
    const predictions = await getAllPredictions();
    const buckets = new Map<string, { won: number; n: number; oddsSum: number }>();
    for (const p of predictions) {
      if (!p || p.status !== 'evaluated') continue;
      const sport = String(p.sport ?? '').toLowerCase();
      for (const leg of Array.isArray(p.legs) ? p.legs : []) {
        if (!leg || (leg.outcome !== 'won' && leg.outcome !== 'lost')) continue;
        const player = String(leg.leg_name ?? '').trim();
        if (!player) continue;
        const market = String(leg.market ?? '').trim().toLowerCase() || 'unknown';
        const side = leg.side ?? (/\bunder\b/i.test(player) ? 'under' : 'over');
        const line = leg.line != null
          ? Number(leg.line)
          : Number(String(leg.target_line ?? '').replace(/[^\d.]/g, ''));
        const key = evidenceKey(sport, player, market, side, Number.isFinite(line) ? line : null);
        const bucket = buckets.get(key) ?? { won: 0, n: 0, oddsSum: 0 };
        bucket.n += 1;
        if (leg.outcome === 'won') bucket.won += 1;
        const decimal = evidenceAmericanToDecimal(parseInt(String(leg.implied_odds ?? '').replace(/[^\d-]/g, ''), 10));
        if (decimal != null) bucket.oddsSum += decimal;
        buckets.set(key, bucket);
      }
    }
    const rows: ModelEvidence[] = [];
    for (const [key, bucket] of buckets) {
      if (bucket.n < EVIDENCE_MIN_SAMPLES) continue; // no verified edge on tiny samples
      const hitRate = bucket.won / bucket.n;
      const grade = hitRate >= 0.7 ? 'A' : hitRate >= 0.6 ? 'B' : hitRate >= 0.5 ? 'C' : 'D';
      const avgDecimal = bucket.oddsSum / bucket.n || 1;
      const edge = hitRate * avgDecimal - 1;
      const [sport, player, market, side, line] = key.split('|');
      rows.push({
        player,
        sport,
        market,
        side,
        line: line ? Number(line) : null,
        probability: hitRate,
        grade,
        estimatedEdge: Number.isFinite(edge) ? edge : null,
        modelVersion: 'learned-v0.2',
        sampleSize: bucket.n,
        source: 'evaluated-predictions',
        eventDate: '',
        eventId: '',
      });
    }
    return rows;
  } catch (err) {
    console.error('loadModelEvidence failed:', err instanceof Error ? err.message : err);
    return [];
  }
}
