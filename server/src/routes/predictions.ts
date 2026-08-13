// /api/predictions — the self-learning prediction log.
// GET  list + summary; POST  store one [PREDICTION_LOG] payload.

import { Router } from 'express';
import { addPrediction, listPredictions, Prediction } from '../lib/predictionStore.js';

export const predictionsRouter = Router();

predictionsRouter.get('/predictions', (_req, res) => {
  res.json(listPredictions());
});

predictionsRouter.post('/predictions', (req, res) => {
  const body = req.body ?? {};
  const pred: Prediction = {
    prediction_id: String(body.prediction_id ?? `manual-${Date.now()}`),
    timestamp: String(body.timestamp ?? new Date().toISOString()),
    sport: String(body.sport ?? 'MLB').toUpperCase(),
    matchup: String(body.matchup ?? ''),
    bet_type: String(body.bet_type ?? 'PROP'),
    legs: Array.isArray(body.legs) ? body.legs : [],
    recommended_units: body.recommended_units != null ? String(body.recommended_units) : null,
    status: 'pending',
  };
  if (!pred.legs.length) {
    res.status(400).json({ ok: false, error: 'legs must be a non-empty array' });
    return;
  }
  const saved = addPrediction(pred);
  res.json({ ok: true, stored: true, prediction: saved, summary: listPredictions().summary });
});
