import { getAllPredictions, updatePrediction, type Prediction } from './predictionStore.js';

export interface ClosingOddsInput {
  predictionId: string;
  legIndex: number;
  odds: number;
  source: string;
  capturedAt?: string;
}

export interface ClosingOddsResult {
  prediction: Prediction;
  legIndex: number;
  closingOdds: number;
  source: string;
  capturedAt: string;
}

function validAmericanOdds(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0 || Math.abs(n) < 100 || Math.abs(n) > 100000) return null;
  return Math.round(n);
}

function validTimestamp(value: unknown): string {
  const parsed = new Date(typeof value === 'string' ? value : '');
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

export async function recordVerifiedClosingOdds(input: ClosingOddsInput): Promise<ClosingOddsResult> {
  const predictionId = String(input.predictionId ?? '').trim();
  if (!predictionId) throw new Error('predictionId is required');
  if (!Number.isInteger(input.legIndex) || input.legIndex < 0) throw new Error('legIndex must be a non-negative integer');
  const odds = validAmericanOdds(input.odds);
  if (odds == null) throw new Error('odds must be valid American odds');
  const source = String(input.source ?? '').trim().slice(0, 200);
  if (!source) throw new Error('source is required for a verified closing snapshot');
  const capturedAt = validTimestamp(input.capturedAt);

  const predictions = await getAllPredictions();
  const prediction = predictions.find((candidate) => candidate.prediction_id === predictionId);
  if (!prediction) throw new Error('prediction not found');
  if (input.legIndex >= prediction.legs.length) throw new Error('legIndex is out of range');

  const legs = prediction.legs.map((leg, index) => index === input.legIndex
    ? ({
        ...leg,
        closing_odds: odds,
        closing_odds_source: source,
        closing_odds_at: capturedAt,
      } as typeof leg)
    : { ...leg });
  const updated = await updatePrediction(predictionId, { legs });
  if (!updated) throw new Error('prediction update failed');
  return { prediction: updated, legIndex: input.legIndex, closingOdds: odds, source, capturedAt };
}
