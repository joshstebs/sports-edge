// Performance aggregation for the model/accuracy dashboard.
//
// Reuses the existing self-learning engine (buildLearningContext in
// evaluator.ts is the canonical store; this module adds dashboard slices)
// and the storage layer. It does NOT mutate prediction logic — pure read-side
// aggregation.

import {
  getAllPredictions,
  loadLearning,
  storageStatus,
  type LearningContext,
  type Prediction,
  type PredictionLeg,
} from './predictionStore.js';
import { getSportConfig } from '../providers/sportsConfig.js';

type Outcome = 'won' | 'lost' | 'push';

interface Row {
  sport: string;
  market: string;
  model: string;
  p: number | null;
  y: 0 | 1; // 1 = win, 0 = loss; pushes excluded from win-rate
  odds: number | null;
  prediction: Prediction;
  leg: PredictionLeg;
}

interface BandBucket {
  band: string;
  range: string;
  n: number;
  won: number;
  lost: number;
  pushes: number;
  hitRate: number | null;
  netUnits: number;
  priced: number;
}

const BANDS: Array<{ band: string; range: string; test: (p: number) => boolean }> = [
  { band: 'High', range: '>= 70%', test: (p) => p >= 0.7 },
  { band: 'Medium', range: '60–69%', test: (p) => p >= 0.6 && p < 0.7 },
  { band: 'Low', range: '< 60%', test: (p) => p < 0.6 },
];

function parseProbability(value: unknown): number | null {
  const number = Number(String(value ?? '').replace('%', '').trim());
  if (!Number.isFinite(number)) return null;
  const probability = number > 1 ? number / 100 : number;
  return probability >= 0 && probability <= 1 ? probability : null;
}

function parseAmericanOdds(value: unknown): number | null {
  const normalized = String(value ?? '').replace(/−/g, '-').match(/[+-]?\d+/)?.[0];
  const number = normalized == null ? NaN : Number(normalized);
  return Number.isFinite(number) && number !== 0 ? number : null;
}

function americanToUnits(odds: number): number {
  return odds > 0 ? odds / 100 : 100 / -odds;
}

function daysBetween(a: string, b: string): number {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return Infinity;
  return Math.floor(Math.abs(tb - ta) / 86_400_000);
}

function legAmerican(leg: PredictionLeg): number | null {
  // PredictionLeg stores verified odds in implied_odds; fall back to game_odds
  // only if present (client SgpLeg carries it, server row may not).
  return parseAmericanOdds((leg as PredictionLeg & { game_odds?: unknown }).game_odds) ?? parseAmericanOdds(leg.implied_odds);
}

export interface PerformanceSummary {
  storage: ReturnType<typeof storageStatus>;
  generatedAt: string;
  overall: {
    graded: number;
    wins: number;
    losses: number;
    pushes: number;
    winRate: number | null;
    roiPct: number | null;
    units: number | null;
    brierScore: number | null;
    priced: number;
  };
  last7: { graded: number; winRate: number | null; roiPct: number | null };
  last30: { graded: number; winRate: number | null; roiPct: number | null };
  bySport: Array<{ sport: string; graded: number; winRate: number | null; roiPct: number | null }>;
  byMarket: Array<{ market: string; graded: number; winRate: number | null; roiPct: number | null }>;
  byConfidence: BandBucket[];
  models: Array<{ model: string; graded: number; winRate: number | null; roiPct: number | null }>;
  recent: Array<{
    predictionId: string;
    sport: string;
    matchup: string;
    betType: string;
    gradedAt: string | null;
    outcome: Outcome | 'ungraded';
    selection: string;
  }>;
  learning: LearningContext | null;
}

function aggregate(rows: Row[]) {
  let graded = 0;
  let won = 0;
  let lost = 0;
  let pushes = 0;
  let net = 0;
  let priced = 0;
  for (const r of rows) {
    if (r.y === 0 || r.y === 1) {
      graded++;
      if (r.y === 1) won++;
      else lost++;
    }
    if (r.leg.outcome === 'push') pushes++;
    if (r.odds != null) {
      priced++;
      net += (r.y === 1 ? 1 : -1) * americanToUnits(r.odds);
    }
  }
  return {
    graded,
    wins: won,
    losses: lost,
    pushes,
    winRate: graded ? (won / graded) * 100 : null,
    roiPct: priced ? (net / priced) * 100 : null,
    units: priced ? Number(net.toFixed(2)) : null,
    priced,
  };
}

function groupBy(rows: Row[], keyFn: (r: Row) => string) {
  const map = new Map<string, Row[]>();
  for (const r of rows) {
    const key = keyFn(r);
    const arr = map.get(key) ?? [];
    arr.push(r);
    map.set(key, arr);
  }
  return [...map.entries()]
    .map(([key, arr]) => ({ key, ...aggregate(arr) }))
    .sort((a, b) => b.graded - a.graded);
}

function rowsForPredictions(predictions: Prediction[]): Row[] {
  const out: Row[] = [];
  for (const prediction of predictions) {
    for (const leg of prediction.legs) {
      if (leg.outcome !== 'won' && leg.outcome !== 'lost' && leg.outcome !== 'push') continue;
      out.push({
        sport: prediction.sport.toUpperCase(),
        market: String(leg.market ?? 'unknown').trim() || 'unknown',
        model: String(leg.model_version ?? 'unknown').trim() || 'unknown',
        p: parseProbability(leg.model_probability),
        y: leg.outcome === 'won' ? 1 : 0,
        odds: legAmerican(leg),
        prediction,
        leg,
      });
    }
  }
  return out;
}

export async function computePerformance(): Promise<PerformanceSummary> {
  const now = new Date();
  const storage = storageStatus();
  const all = await getAllPredictions();
  const learning = await loadLearning();
  const rows = rowsForPredictions(all);

  const overall = aggregate(rows);

  const within = (days: number | null) => (p: Prediction) => {
    if (days == null) return true;
    const ts = p.evaluatedAt ?? p.timestamp;
    return daysBetween(ts, now.toISOString()) <= days;
  };
  const last7 = aggregate(all.filter(within(7)).flatMap((p) => rowsForPredictions([p])));
  const last30 = aggregate(all.filter(within(30)).flatMap((p) => rowsForPredictions([p])));

  const bySport = groupBy(rows, (r) => r.sport).map((g) => ({ sport: g.key, graded: g.graded, winRate: g.winRate, roiPct: g.roiPct }));
  const byMarket = groupBy(rows, (r) => r.market).map((g) => ({ market: g.key, graded: g.graded, winRate: g.winRate, roiPct: g.roiPct }));
  const byModel = groupBy(rows, (r) => r.model).map((g) => ({ model: g.key, graded: g.graded, winRate: g.winRate, roiPct: g.roiPct }));

  const bandBuckets: Record<string, BandBucket> = {};
  for (const b of BANDS) bandBuckets[b.band] = { band: b.band, range: b.range, n: 0, won: 0, lost: 0, pushes: 0, hitRate: null, netUnits: 0, priced: 0 };
  for (const r of rows) {
    if (r.p == null) continue;
    const band = BANDS.find((b) => b.test(r.p as number));
    if (!band) continue;
    const bucket = bandBuckets[band.band];
    bucket.n++;
    if (r.leg.outcome === 'won') bucket.won++;
    else if (r.leg.outcome === 'lost') bucket.lost++;
    else if (r.leg.outcome === 'push') bucket.pushes++;
    if (r.odds != null) {
      bucket.priced++;
      bucket.netUnits += (r.y === 1 ? 1 : -1) * americanToUnits(r.odds);
    }
  }
  const byConfidence = BANDS.map((b) => {
    const bucket = bandBuckets[b.band];
    return {
      ...bucket,
      hitRate: bucket.n ? (bucket.won / bucket.n) * 100 : null,
      netUnits: Number(bucket.netUnits.toFixed(2)),
    };
  }).filter((b) => b.n > 0);

  const recent = rows
    .map((r) => ({
      predictionId: r.prediction.prediction_id,
      sport: r.sport,
      matchup: r.prediction.matchup,
      betType: r.prediction.bet_type,
      gradedAt: r.leg.evaluated_at ?? r.prediction.evaluatedAt ?? null,
      outcome: (r.leg.outcome as Outcome) ?? 'ungraded',
      selection: String(r.leg.leg_name ?? '').slice(0, 120),
    }))
    .filter((r) => r.gradedAt != null)
    .sort((a, b) => (a.gradedAt! < b.gradedAt! ? 1 : -1))
    .slice(0, 25);

  return {
    storage,
    generatedAt: now.toISOString(),
    overall: { ...overall, brierScore: learning?.brierScore ?? null, winRate: overall.winRate },
    last7: { graded: last7.graded, winRate: last7.winRate, roiPct: last7.roiPct },
    last30: { graded: last30.graded, winRate: last30.winRate, roiPct: last30.roiPct },
    bySport,
    byMarket,
    byConfidence,
    models: byModel,
    recent,
    learning,
  };
}
