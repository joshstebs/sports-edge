import { createHash, randomUUID } from 'node:crypto';
import { redisCommand, redisConfigured } from '../lib/predictionStore.js';
import type { ModelSport } from '../models/playerPropModel.js';

const PREFIX = process.env.SPORTS_EDGE_REDIS_PREFIX || 'sports-edge';
const KEY = `${PREFIX}:candidate-history:v1`;
const MAX_RECORDS = 2500;
const MAX_HISTORY_BYTES = 700_000;

export type CandidateOutcome = 'won' | 'lost' | 'push' | 'pending' | 'ungraded';

export interface CandidateHistoryRecord {
  id: string;
  evaluatedAt: string;
  eventDate: string;
  eventId: string | number | null;
  sport: ModelSport;
  player: string;
  team: string | null;
  opponent: string | null;
  market: string;
  side: 'over' | 'under';
  line: number;
  modelProbability: number;
  grade: 'A' | 'B' | 'C' | 'D';
  sampleSize: number;
  modelVersion: string;
  modelSource: string;
  sources: string[];
  fallbackUsed: boolean;
  actual: number | null;
  outcome: CandidateOutcome;
  gradedAt: string | null;
  metadata?: Record<string, unknown>;
  price?: { americanOdds: number; source: string; checkedAt: string; eventStart: string };
  playerId?: string | number | null;
}

let memory: CandidateHistoryRecord[] = [];

function fingerprint(input: Omit<CandidateHistoryRecord, 'id' | 'evaluatedAt' | 'actual' | 'outcome' | 'gradedAt'>): string {
  return [input.eventDate, input.eventId ?? '', input.sport, input.player.toLowerCase(), input.market, input.side,
    input.price ? input.modelVersion + ':priced' : input.line].join('|');
}

export async function loadCandidateHistory(): Promise<CandidateHistoryRecord[]> {
  if (!redisConfigured()) return [...memory];
  try {
    const raw = await redisCommand<string | null>(['GET', KEY]);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as CandidateHistoryRecord[] : [];
  } catch {
    return [];
  }
}

// Compare the full snapshot before writing so a simultaneous scan and grade
// cannot discard each other's rows during a hosted rollout.
const COMPARE_AND_SAVE = `
local current = redis.call('GET', KEYS[1])
if redis.sha1hex(current or '') ~= ARGV[1] then return 0 end
redis.call('SET', KEYS[1], ARGV[2])
return 1`;

async function mutate(update: (rows: CandidateHistoryRecord[]) => boolean): Promise<boolean> {
  if (!redisConfigured()) {
    const next = memory.map(row => ({ ...row }));
    if (!update(next)) return false;
    memory = next.slice(-MAX_RECORDS);
    return true;
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    const raw = await redisCommand<string | null>(['GET', KEY]);
    const rows: CandidateHistoryRecord[] = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(rows)) throw new Error('Invalid candidate history');
    if (!update(rows)) return false;
    let retained = rows.slice(-MAX_RECORDS);
    let payload = JSON.stringify(retained);
    while (Buffer.byteLength(payload) > MAX_HISTORY_BYTES) {
      retained = retained.slice(Math.max(1, Math.floor(retained.length * 0.1)));
      payload = JSON.stringify(retained);
    }
    const snapshotHash = createHash('sha1').update(raw ?? '').digest('hex');
    const written = await redisCommand<number>(['EVAL', COMPARE_AND_SAVE, 1, KEY, snapshotHash, payload]);
    if (written === 1) return true;
  }
  throw new Error('Candidate history changed repeatedly. Retry the update.');
}

export async function recordCandidateEvaluations(
  inputs: Array<Omit<CandidateHistoryRecord, 'id' | 'evaluatedAt' | 'actual' | 'outcome' | 'gradedAt'>>,
): Promise<void> {
  if (!inputs.length) return;
  const now = new Date().toISOString();
  await mutate(existing => {
    const keys = new Set(existing.map(fingerprint));
    const initialSize = existing.length;
    for (const input of inputs) {
      const key = fingerprint(input);
      if (keys.has(key)) continue;
      keys.add(key);
      existing.push({
        ...input, id: randomUUID(), evaluatedAt: now,
        actual: null, outcome: 'pending', gradedAt: null,
      });
    }
    return existing.length !== initialSize;
  });
}

export async function updateCandidateOutcomes(
  patches: Array<{ id: string; actual: number | null; outcome: CandidateOutcome; gradedAt?: string }>,
): Promise<number> {
  if (!patches.length) return 0;
  const byId = new Map(patches.map(patch => [patch.id, patch]));
  const now = new Date().toISOString();
  let updated = 0;
  await mutate(rows => {
    updated = 0;
    for (const row of rows) {
      const patch = byId.get(row.id);
      if (!patch || row.outcome !== 'pending') continue;
      row.actual = patch.actual;
      row.outcome = patch.outcome;
      row.gradedAt = patch.gradedAt ?? now;
      updated++;
    }
    return updated > 0;
  });
  return updated;
}

export async function candidateCalibration(sport: ModelSport, market: string): Promise<{
  n: number;
  hitRate: number | null;
  averageConfidence: number | null;
  calibrationError: number | null;
}> {
  const rows = (await loadCandidateHistory()).filter((row) =>
    row.sport === sport && row.market === market && (row.outcome === 'won' || row.outcome === 'lost')
  );
  if (!rows.length) return { n: 0, hitRate: null, averageConfidence: null, calibrationError: null };
  const hitRate = rows.filter((row) => row.outcome === 'won').length / rows.length;
  const averageConfidence = rows.reduce((sum, row) => sum + row.modelProbability, 0) / rows.length;
  return {
    n: rows.length,
    hitRate: Math.round(hitRate * 1000) / 10,
    averageConfidence: Math.round(averageConfidence * 1000) / 10,
    calibrationError: Math.round((averageConfidence - hitRate) * 1000) / 10,
  };
}

export async function updateCandidateOutcome(
  id: string, patch: { actual: number | null; outcome: CandidateOutcome; gradedAt?: string },
): Promise<boolean> {
  return await updateCandidateOutcomes([{ id, ...patch }]) > 0;
}
