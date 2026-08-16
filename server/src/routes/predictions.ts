// /api/predictions — read-only authenticated self-learning history. New rows
// are accepted only from the server-side, availability-gated chat pipeline.

import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { listPredictions, StorageNotConfiguredError, storageStatus } from '../lib/predictionStore.js';
import { runPredictionEvaluation } from '../lib/evaluator.js';

export const predictionsRouter = Router();
export const evaluationRouter = Router();
let evaluationInFlight: ReturnType<typeof runPredictionEvaluation> | null = null;

function cronAuthorized(header: string | undefined): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || !header?.startsWith('Bearer ')) return false;
  const supplied = header.slice('Bearer '.length);
  const expectedBuffer = Buffer.from(secret);
  const suppliedBuffer = Buffer.from(supplied);
  return suppliedBuffer.length === expectedBuffer.length && timingSafeEqual(suppliedBuffer, expectedBuffer);
}

function torontoHour(now = new Date()): number {
  const hour = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto', hour: '2-digit', hour12: false,
  }).formatToParts(now).find((part) => part.type === 'hour')?.value;
  return Number(hour);
}

// Vercel Cron schedules are UTC. vercel.json invokes this at both 10:00 and
// 11:00 UTC so one invocation always lands at 06:00 America/Toronto across
// daylight-saving changes. The other invocation is an authenticated no-op.
evaluationRouter.get('/evaluate', async (req, res) => {
  if (!process.env.CRON_SECRET) {
    res.status(503).json({ ok: false, code: 'CRON_NOT_CONFIGURED', error: 'CRON_SECRET is required' });
    return;
  }
  if (!cronAuthorized(req.header('authorization'))) {
    res.status(401).json({ ok: false, code: 'UNAUTHORIZED', error: 'Invalid cron authorization' });
    return;
  }
  if (torontoHour() !== 6) {
    res.json({ ok: true, skipped: true, reason: 'outside 06:00 America/Toronto evaluation window' });
    return;
  }
  try {
    if (!evaluationInFlight) evaluationInFlight = runPredictionEvaluation().finally(() => { evaluationInFlight = null; });
    const result = await evaluationInFlight;
    res.json({ ok: true, storage: storageStatus(), ...result });
  } catch (error) {
    const unavailable = error instanceof StorageNotConfiguredError;
    res.status(unavailable ? 503 : 500).json({ ok: false, code: unavailable ? error.code : 'EVALUATION_ERROR', error: (error as Error).message });
  }
});

predictionsRouter.get('/predictions', async (_req, res) => {
  const userId = _req.auth!.userId;
  try { res.json({ ...(await listPredictions(userId)), storage: storageStatus() }); }
  catch (error) {
    const unavailable = error instanceof StorageNotConfiguredError;
    res.status(unavailable ? 503 : 500).json({ ok: false, code: unavailable ? error.code : 'STORAGE_ERROR', error: (error as Error).message });
  }
});
