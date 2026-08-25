import { randomUUID } from 'node:crypto';
import { redisCommand, redisConfigured } from '../lib/predictionStore.js';
import type { ModelSport } from '../models/playerPropModel.js';

const PREFIX = process.env.SPORTS_EDGE_REDIS_PREFIX || 'sports-edge';
const KEY = `${PREFIX}:candidate-history:v1`;
const MAX_RECORDS = 2500;

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
}

let memory: CandidateHistoryRecord[] = [];

function fingerprint(input: Omit<CandidateHistoryRecord, 'id' | 'evaluatedAt' | 'actual' | 'outcome' | 'gradedAt'>): string {
  return [input.eventDate, input.eventId ?? '', input.sport, input.player.toLowerCase(), input.market, input.side, input.line].join('|');
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

async function save(records: CandidateHistoryRecord[]): Promise<void> {
  const trimmed = records.slice(-MAX_RECORDS);
  if (!redisConfigured()) {
    memory = trimmed;
    return;
  }
  await redisCommand(['SET', KEY, JSON.stringify(trimmed)]);
}

export async function recordCandidateEvaluations(
  inputs: Array<Omit<CandidateHistoryRecord, 'id' | 'evaluatedAt' | 'actual' | 'outcome' | 'gradedAt'>>,
): Promise<void> {
  if (!inputs.length) return;
  const existing = await loadCandidateHistory();
  const keys = new Set(existing.map((row) => fingerprint(row)));
  const now = new Date().toISOString();
  for (const input of inputs) {
    const key = fingerprint(input);
    if (keys.has(key)) continue;
    keys.add(key);
    existing.push({
      ...input,
      id: randomUUID(),
      evaluatedAt: now,
      actual: null,
      outcome: 'pending',
      gradedAt: null,
    });
  }
  await save(existing);
}

export async function updateCandidateOutcome(
  id: string,
  patch: { actual: number | null; outcome: CandidateOutcome; gradedAt?: string },
): Promise<boolean> {
  const existing = await loadCandidateHistory();
  const row = existing.find((item) => item.id === id);
  if (!row) return false;
  row.actual = patch.actual;
  row.outcome = patch.outcome;
  row.gradedAt = patch.gradedAt ?? new Date().toISOString();
  await save(existing);
  return true;
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
