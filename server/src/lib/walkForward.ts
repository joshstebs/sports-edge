import type { Prediction } from './predictionStore.js';

interface Sample { at: number; settled: number; market: string; model: string; p: number; odds: number; result: 0 | 1 }

function probability(value: unknown): number | null {
  if (value == null || String(value).trim() === '') return null;
  const n = Number(String(value).replace('%', ''));
  const p = n > 1 ? n / 100 : n;
  return Number.isFinite(p) && p > 0 && p < 1 ? p : null;
}

function price(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && Math.abs(n) >= 100 ? n : null;
}

function implied(odds: number): number { return odds > 0 ? 100 / (odds + 100) : -odds / (-odds + 100); }

export interface WalkForwardRow {
  model: string; market: string; samples: number; brier: number; marketBrier: number;
  roiPct: number; meanCalibrationErrorPct: number;
}

/** Scores only predictions made before an outcome was known. Each test-day
 * calibration uses results settled before that day; no same-day labels leak. */
export function walkForwardReport(predictions: Prediction[], minimumHistory = 20): { rows: WalkForwardRow[]; skipped: Record<string, number> } {
  const skipped = { invalid: 0, unpriced: 0, unsettled: 0, noHistory: 0 };
  const samples: Sample[] = [];
  for (const prediction of predictions) {
    for (const leg of prediction.legs) {
      if (leg.outcome !== 'won' && leg.outcome !== 'lost') { skipped.unsettled++; continue; }
      const at = Date.parse(prediction.timestamp);
      const settled = Date.parse(leg.evaluated_at ?? prediction.evaluatedAt ?? '');
      const p = probability(leg.model_probability);
      const odds = price(leg.game_odds ?? leg.implied_odds);
      if (!Number.isFinite(at) || !Number.isFinite(settled) || settled <= at || p == null) { skipped.invalid++; continue; }
      if (odds == null) { skipped.unpriced++; continue; }
      samples.push({ at, settled, market: `${prediction.sport.toUpperCase()}:${leg.market || 'unknown'}`,
        model: leg.model_version || 'unknown', p, odds, result: leg.outcome === 'won' ? 1 : 0 });
    }
  }
  samples.sort((a, b) => a.at - b.at);
  const groups = new Map<string, { model: string; market: string; n: number; brier: number; marketBrier: number; units: number; error: number }>();
  for (const sample of samples) {
    const day = new Date(sample.at).toISOString().slice(0, 10);
    const cutoff = Date.parse(`${day}T00:00:00Z`);
    const history = samples.filter((row) => row.model === sample.model && row.market === sample.market && row.settled < cutoff);
    if (history.length < minimumHistory) { skipped.noHistory++; continue; }
    // Historical residual correction, shrunk by 20 observations toward zero.
    const residual = history.reduce((sum, row) => sum + row.result - row.p, 0) / (history.length + 20);
    const calibrated = Math.max(0.01, Math.min(0.99, sample.p + residual));
    const key = `${sample.model}|${sample.market}`;
    const row = groups.get(key) ?? { model: sample.model, market: sample.market, n: 0, brier: 0, marketBrier: 0, units: 0, error: 0 };
    row.n++;
    row.brier += (calibrated - sample.result) ** 2;
    row.marketBrier += (implied(sample.odds) - sample.result) ** 2;
    row.units += sample.result ? (sample.odds > 0 ? sample.odds / 100 : 100 / -sample.odds) : -1;
    row.error += calibrated - sample.result;
    groups.set(key, row);
  }
  return { rows: [...groups.values()].map((row) => ({ model: row.model, market: row.market, samples: row.n,
    brier: row.brier / row.n, marketBrier: row.marketBrier / row.n,
    roiPct: 100 * row.units / row.n, meanCalibrationErrorPct: 100 * row.error / row.n,
  })).sort((a, b) => b.samples - a.samples), skipped };
}
