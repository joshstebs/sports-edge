// /api/predictions — read-only authenticated self-learning history. New rows
// are accepted only from the server-side, availability-gated chat pipeline.

import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { listPredictions, StorageNotConfiguredError, storageStatus } from '../lib/predictionStore.js';
import { runPredictionEvaluation } from '../lib/evaluator.js';
import { computePerformance } from '../lib/performance.js';
import { recordVerifiedClosingOdds } from '../lib/closingOdds.js';
import { buildDiagnostics, predictionCsvForUser } from '../lib/diagnostics.js';
import { gradePendingCandidateHistory } from '../candidates/candidateGrader.js';
import { SPORTS } from '../providers/sportsConfig.js';

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
    if (!evaluationInFlight) evaluationInFlight = runPredictionEvaluation({
      maxPredictions: 25,
      maxLegs: 60,
      timeBudgetMs: 38_000,
    }).finally(() => { evaluationInFlight = null; });
    const result = await evaluationInFlight;
    const candidateHistory = await gradePendingCandidateHistory({ limit: 40, timeBudgetMs: 14_000 }).catch((error) => ({
      processed: 0,
      graded: 0,
      pending: -1,
      error: (error as Error).message,
    }));
    res.json({ ok: true, storage: storageStatus(), candidateHistory, ...result });
  } catch (error) {
    const unavailable = error instanceof StorageNotConfiguredError;
    res.status(unavailable ? 503 : 500).json({ ok: false, code: unavailable ? error.code : 'EVALUATION_ERROR', error: (error as Error).message });
  }
});

// Controlled write path for a verified closing-price snapshot. This is
// intentionally protected by the same CRON_SECRET as evaluation so browser
// clients cannot invent closing lines. Hermes/a scheduled odds collector can
// submit a sourced price just before market close; the dashboard calculates
// CLV automatically from the stored recommendation price vs this close.
evaluationRouter.post('/closing-odds', async (req, res) => {
  if (!process.env.CRON_SECRET) {
    res.status(503).json({ ok: false, code: 'CRON_NOT_CONFIGURED', error: 'CRON_SECRET is required' });
    return;
  }
  if (!cronAuthorized(req.header('authorization'))) {
    res.status(401).json({ ok: false, code: 'UNAUTHORIZED', error: 'Invalid cron authorization' });
    return;
  }
  try {
    const result = await recordVerifiedClosingOdds({
      predictionId: String(req.body?.predictionId ?? ''),
      legIndex: Number(req.body?.legIndex),
      odds: Number(req.body?.odds),
      source: String(req.body?.source ?? ''),
      capturedAt: typeof req.body?.capturedAt === 'string' ? req.body.capturedAt : undefined,
    });
    res.json({
      ok: true,
      predictionId: result.prediction.prediction_id,
      legIndex: result.legIndex,
      closingOdds: result.closingOdds,
      source: result.source,
      capturedAt: result.capturedAt,
    });
  } catch (error) {
    const unavailable = error instanceof StorageNotConfiguredError;
    const message = (error as Error).message;
    const validation = /required|must be|out of range|not found|invalid/i.test(message);
    res.status(unavailable ? 503 : validation ? 400 : 500).json({
      ok: false,
      code: unavailable ? error.code : validation ? 'INVALID_CLOSING_ODDS' : 'CLOSING_ODDS_ERROR',
      error: message,
    });
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

predictionsRouter.get('/predictions/diagnostics', async (_req, res) => {
  try {
    res.json({ ok: true, diagnostics: await buildDiagnostics() });
  } catch (error) {
    const unavailable = error instanceof StorageNotConfiguredError;
    res.status(unavailable ? 503 : 500).json({
      ok: false,
      code: unavailable ? error.code : 'DIAGNOSTICS_ERROR',
      error: unavailable ? error.message : 'Could not build diagnostics.',
    });
  }
});

predictionsRouter.get('/predictions/export.csv', async (_req, res) => {
  try {
    const csv = await predictionCsvForUser(_req.auth!.userId);
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="sportsedge-predictions-${stamp}.csv"`);
    res.send(csv);
  } catch (error) {
    const unavailable = error instanceof StorageNotConfiguredError;
    res.status(unavailable ? 503 : 500).json({
      ok: false,
      code: unavailable ? error.code : 'EXPORT_ERROR',
      error: unavailable ? error.message : 'Could not export predictions.',
    });
  }
});

// /api/predictions/performance — model/accuracy dashboard (admin/signed-in).
// Read-only aggregation; never mutates prediction logic.
predictionsRouter.get('/predictions/performance', async (_req, res) => {
  try {
    const [performance, sports] = await Promise.all([computePerformance(), Promise.resolve(SPORTS.map((s) => ({
      code: s.code, name: s.name, status: s.status, supportedMarkets: s.supportedMarkets,
      inputs: s.inputs, playerProps: s.playerProps,
    })))]);
    res.json({ ok: true, generatedAt: performance.generatedAt, performance, sports });
  } catch (error) {
    const unavailable = error instanceof StorageNotConfiguredError;
    res.status(unavailable ? 503 : 500).json({ ok: false, code: unavailable ? error.code : 'PERFORMANCE_ERROR', error: (error as Error).message });
  }
});