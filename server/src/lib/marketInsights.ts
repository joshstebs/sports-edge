import type { Prediction, PredictionLeg } from './predictionStore.js';

export interface TopEdgePick {
  predictionId: string;
  sport: string;
  matchup: string;
  selection: string;
  market: string;
  eventDate: string | null;
  recommendedAt: string;
  confidence: number;
  odds: number | null;
  impliedProbability: number | null;
  edgePct: number | null;
  model: string;
  source: string | null;
  /** Sample size behind the model probability, when the model reported one. */
  modelSampleSize?: number | null;
  /** Availability-gate note persisted at logging time (null = fully verified at log time). */
  lineupStatus?: string | null;
}

export interface CalibrationDiagnostic {
  graded: number;
  averageConfidence: number | null;
  hitRate: number | null;
  gapPct: number | null;
  status: 'insufficient-data' | 'well-calibrated' | 'overconfident' | 'underconfident';
}

export interface ClvSummary {
  eligiblePriced: number;
  tracked: number;
  coveragePct: number | null;
  averagePriceEdgePct: number | null;
  averageImpliedMovePct: number | null;
  positiveClv: number;
  negativeClv: number;
  note: string;
}

export interface MarketInsights {
  topEdges: TopEdgePick[];
  calibration: CalibrationDiagnostic;
  clv: ClvSummary;
}

function displayMarket(value: unknown): string {
  const labels: Record<string, string> = {
    hits: 'Hits', totalBases: 'Total Bases', homeRuns: 'Home Runs', rbi: 'RBIs', runs: 'Runs',
    strikeouts: 'Strikeouts', outsRecorded: 'Outs Recorded', passingYards: 'Passing Yards',
    passingTouchdowns: 'Passing Touchdowns', rushingYards: 'Rushing Yards', receivingYards: 'Receiving Yards',
    receptions: 'Receptions', rushingReceivingYards: 'Rushing + Receiving Yards', touchdowns: 'Touchdowns',
    points: 'Points', rebounds: 'Rebounds', assists: 'Assists', threePointersMade: '3-Pointers',
    shotsOnGoal: 'Shots on Goal', hockeyPoints: 'Hockey Points', saves: 'Saves', goals: 'Goals',
  };
  const key = String(value ?? '').trim();
  return labels[key] ?? key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
}

function probability(value: unknown): number | null {
  if (value == null || String(value).trim() === '') return null;
  const n = Number(String(value).replace('%', '').trim());
  if (!Number.isFinite(n)) return null;
  const p = n > 1 ? n / 100 : n;
  return p >= 0 && p <= 1 ? p : null;
}

function americanOdds(value: unknown): number | null {
  if (value == null || String(value).trim() === '') return null;
  const normalized = String(value).replace(/−/g, '-').match(/[+-]?\d+/)?.[0];
  const n = normalized == null ? NaN : Number(normalized);
  return Number.isFinite(n) && n !== 0 ? n : null;
}

export function americanImpliedProbability(odds: number): number {
  return odds > 0 ? 100 / (odds + 100) : Math.abs(odds) / (Math.abs(odds) + 100);
}

export function americanDecimalOdds(odds: number): number {
  return odds > 0 ? 1 + odds / 100 : 1 + 100 / Math.abs(odds);
}

function torontoDate(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

function eventDate(prediction: Prediction): string | null {
  if (prediction.gameDate && /^\d{4}-\d{2}-\d{2}$/.test(prediction.gameDate)) return prediction.gameDate;
  const legacy = prediction.timestamp?.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(legacy) ? legacy : null;
}

function legOdds(leg: PredictionLeg): number | null {
  return americanOdds((leg as PredictionLeg & { game_odds?: unknown }).game_odds) ?? americanOdds(leg.implied_odds);
}

function closingOdds(leg: PredictionLeg): number | null {
  const extended = leg as PredictionLeg & { closing_odds?: unknown; closingOdds?: unknown };
  return americanOdds(extended.closing_odds ?? extended.closingOdds);
}

function buildTopEdges(predictions: Prediction[], now: Date): TopEdgePick[] {
  const today = torontoDate(now);
  const rows: TopEdgePick[] = [];
  const seen = new Set<string>();

  for (const prediction of predictions) {
    if (prediction.status !== 'pending') continue;
    const date = eventDate(prediction);
    if (date !== today) continue;

    for (const leg of prediction.legs) {
      const p = probability(leg.model_probability);
      if (p == null || p < 0.58) continue;
      const odds = legOdds(leg);
      const implied = odds == null ? null : americanImpliedProbability(odds);
      const edgePct = implied == null ? null : (p - implied) * 100;
      if (edgePct != null && edgePct <= 0) continue;
      const rawSelection = String(leg.leg_name ?? '').trim();
      if (!rawSelection) continue;
      const market = String(leg.market ?? 'unknown');
      const marketText = displayMarket(market);
      const selection = rawSelection.toLowerCase().includes(marketText.toLowerCase()) ? rawSelection : `${rawSelection} ${marketText}`;
      const key = `${prediction.sport}|${prediction.matchup}|${selection}`.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({
        predictionId: prediction.prediction_id,
        sport: prediction.sport.toUpperCase(),
        matchup: prediction.matchup,
        selection: selection.slice(0, 180),
        market,
        eventDate: date,
        recommendedAt: prediction.timestamp,
        confidence: Number((p * 100).toFixed(1)),
        odds,
        impliedProbability: implied == null ? null : Number((implied * 100).toFixed(1)),
        edgePct: edgePct == null ? null : Number(edgePct.toFixed(1)),
        model: String(leg.model_version ?? 'unknown'),
        source: leg.model_source ? String(leg.model_source) : null,
        modelSampleSize: leg.model_sample_size ?? null,
        lineupStatus: (leg as PredictionLeg & { gate_note?: string | null }).gate_note ?? null,
      });
    }
  }

  return rows
    .sort((a, b) => {
      if (a.edgePct != null && b.edgePct != null) return b.edgePct - a.edgePct || b.confidence - a.confidence;
      if (a.edgePct != null) return -1;
      if (b.edgePct != null) return 1;
      return b.confidence - a.confidence;
    })
    .slice(0, 12);
}

function buildCalibration(predictions: Prediction[]): CalibrationDiagnostic {
  let n = 0;
  let sumP = 0;
  let wins = 0;
  for (const prediction of predictions) {
    for (const leg of prediction.legs) {
      if (leg.outcome !== 'won' && leg.outcome !== 'lost') continue;
      const p = probability(leg.model_probability);
      if (p == null) continue;
      n++;
      sumP += p;
      if (leg.outcome === 'won') wins++;
    }
  }
  if (n === 0) {
    return { graded: 0, averageConfidence: null, hitRate: null, gapPct: null, status: 'insufficient-data' };
  }
  const avg = (sumP / n) * 100;
  const hit = (wins / n) * 100;
  const gap = hit - avg;
  const status: CalibrationDiagnostic['status'] = n < 20
    ? 'insufficient-data'
    : Math.abs(gap) <= 3
      ? 'well-calibrated'
      : gap < 0 ? 'overconfident' : 'underconfident';
  return {
    graded: n,
    averageConfidence: Number(avg.toFixed(1)),
    hitRate: Number(hit.toFixed(1)),
    gapPct: Number(gap.toFixed(1)),
    status,
  };
}

function buildClv(predictions: Prediction[]): ClvSummary {
  let eligiblePriced = 0;
  let tracked = 0;
  let sumPriceEdge = 0;
  let sumImpliedMove = 0;
  let positiveClv = 0;
  let negativeClv = 0;

  for (const prediction of predictions) {
    for (const leg of prediction.legs) {
      const recommended = legOdds(leg);
      if (recommended == null) continue;
      eligiblePriced++;
      const close = closingOdds(leg);
      if (close == null) continue;
      tracked++;
      const recommendedDecimal = americanDecimalOdds(recommended);
      const closeDecimal = americanDecimalOdds(close);
      const priceEdge = (recommendedDecimal / closeDecimal - 1) * 100;
      const impliedMove = (americanImpliedProbability(close) - americanImpliedProbability(recommended)) * 100;
      sumPriceEdge += priceEdge;
      sumImpliedMove += impliedMove;
      if (priceEdge > 0.05) positiveClv++;
      else if (priceEdge < -0.05) negativeClv++;
    }
  }

  return {
    eligiblePriced,
    tracked,
    coveragePct: eligiblePriced ? Number(((tracked / eligiblePriced) * 100).toFixed(1)) : null,
    averagePriceEdgePct: tracked ? Number((sumPriceEdge / tracked).toFixed(2)) : null,
    averageImpliedMovePct: tracked ? Number((sumImpliedMove / tracked).toFixed(2)) : null,
    positiveClv,
    negativeClv,
    note: tracked
      ? 'Positive CLV means SportsEdge captured a better price than the verified closing price.'
      : 'No verified closing-price snapshots are stored yet. SportsEdge will not fabricate CLV from final results or stale odds.',
  };
}

export function buildMarketInsights(predictions: Prediction[], now = new Date()): MarketInsights {
  return {
    topEdges: buildTopEdges(predictions, now),
    calibration: buildCalibration(predictions),
    clv: buildClv(predictions),
  };
}
