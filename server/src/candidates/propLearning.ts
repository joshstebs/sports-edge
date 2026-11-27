import type { PropLearningReport, PropTrend } from '../workspace.js';
import type { CandidateHistoryRecord } from './candidateHistory.js';

const MIN_TRAIN = 24;
const MIN_HOLDOUT = 12;
const MIN_TRAIN_DAYS = 6;
const MIN_HOLDOUT_DAYS = 4;
const MIN_BRIER_IMPROVEMENT = 0.001;
const MAX_ADJUSTMENT = 0.06;

type SettledOffer = CandidateHistoryRecord & { result: 0 | 1; knownAt: number };

function modelKey(row: Pick<CandidateHistoryRecord, 'sport' | 'market' | 'side' | 'modelVersion'>): string {
  return JSON.stringify([row.sport, row.market, row.side, row.modelVersion]);
}

export function adjustedPropProbability(probability: number, adjustment: number): number {
  return Math.max(0.01, Math.min(0.99, probability + adjustment));
}

function brier(rows: SettledOffer[], adjustment = 0): number {
  return rows.reduce((sum, row) => sum + ((adjustment ? adjustedPropProbability(row.modelProbability, adjustment) : row.modelProbability) - row.result) ** 2, 0) / rows.length;
}

function trainTrend(rows: SettledOffer[]): PropTrend | null {
  const days = [...new Set(rows.map(row => row.eventDate))].sort();
  if (days.length < MIN_TRAIN_DAYS + MIN_HOLDOUT_DAYS) return null;

  const split = days.length - Math.max(MIN_HOLDOUT_DAYS, Math.ceil(days.length * 0.3));
  const holdoutDays = new Set(days.slice(split));
  const holdout = rows.filter(row => holdoutDays.has(row.eventDate));
  const firstOffer = Math.min(...holdout.map(row => Date.parse(row.evaluatedAt)));
  const train = rows.filter(row => !holdoutDays.has(row.eventDate) && row.knownAt < firstOffer);
  if (train.length < MIN_TRAIN || holdout.length < MIN_HOLDOUT
    || new Set(train.map(row => row.eventDate)).size < MIN_TRAIN_DAYS) return null;

  const residual = train.reduce((sum, row) => sum + row.result - row.modelProbability, 0);
  const adjustment = Math.max(-MAX_ADJUSTMENT, Math.min(MAX_ADJUSTMENT, residual / (train.length + 24)));
  const baselineBrier = brier(holdout);
  const adjustedBrier = brier(holdout, adjustment);
  const { sport, market, side, modelVersion } = train[0];
  return {
    sport, market, side, modelVersion, trainCount: train.length, holdoutCount: holdout.length,
    baselineBrier, adjustedBrier, adjustment,
    active: baselineBrier - adjustedBrier >= MIN_BRIER_IMPROVEMENT,
  };
}

export function learnPropTrends(history: CandidateHistoryRecord[], now = Date.now()) {
  const tracked = history.filter(row => {
    const cutoff = Date.parse(row.price?.eventStart ?? '');
    const quotedAt = Date.parse(row.price?.checkedAt ?? '');
    const observedAt = Date.parse(row.evaluatedAt);
    return row.price && Number.isInteger(row.price.americanOdds) && Math.abs(row.price.americanOdds) >= 100
      && Number.isFinite(row.line) && Math.abs(row.line % 1) === 0.5
      && row.eventId != null && quotedAt <= observedAt && observedAt < cutoff && observedAt <= now;
  });
  const groups = new Map<string, SettledOffer[]>();
  let settled = 0;
  for (const row of tracked) {
    if (row.outcome !== 'won' && row.outcome !== 'lost') continue;
    const knownAt = Date.parse(row.gradedAt ?? '');
    if (!(knownAt > Date.parse(row.price!.eventStart) && knownAt <= now)
      || !Number.isFinite(row.modelProbability) || row.modelProbability <= 0 || row.modelProbability >= 1) continue;
    settled += 1;
    const key = modelKey(row);
    const rows = groups.get(key) ?? [];
    rows.push({ ...row, result: row.outcome === 'won' ? 1 : 0, knownAt });
    groups.set(key, rows);
  }

  const rules = new Map<string, PropTrend>();
  for (const [key, rows] of groups) {
    const trend = trainTrend(rows);
    if (trend) rules.set(key, trend);
  }
  const report: PropLearningReport = {
    tracked: tracked.length,
    pending: tracked.filter(row => row.outcome === 'pending').length,
    settled,
    trends: [...rules.values()].sort((a, b) => Number(b.active) - Number(a.active) || b.holdoutCount - a.holdoutCount),
  };
  return {
    report,
    getTrend: (row: Parameters<typeof modelKey>[0]) => {
      const trend = rules.get(modelKey(row));
      return trend?.active ? trend : null;
    },
  };
}
