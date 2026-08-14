// SportsEdge Express app (framework-agnostic — used by the local listener AND
// the Vercel serverless function via api/index.ts).

import express, { NextFunction, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { chatRouter } from './routes/chat.js';
import { healthRouter } from './routes/health.js';
import { ledgerRouter } from './routes/ledger.js';
import { predictionsRouter } from './routes/predictions.js';

const app = express();
app.use(express.json({ limit: '12mb' })); // room for attached screenshots (data URLs)
app.use(express.urlencoded({ extended: false }));

// Public deployment guard: cap per-IP abuse (LLM quota burn, ledger spam).
// In-memory per-instance — real protection on Vercel, plus validation above.
const chatLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Rate limit reached — try again in a few minutes.' },
});
const writeLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Rate limit reached — try again in a few minutes.' },
});

app.use('/api/chat', chatLimiter);
app.use('/api/ledger', writeLimiter);
app.use('/api', healthRouter);
app.use('/api', chatRouter);
app.use('/api', ledgerRouter);
app.use('/api', predictionsRouter);

app.get('/', (_req, res) => {
  res.json({ name: 'sports-edge-server', version: '0.1.0', endpoints: ['/api/health', '/api/sources', '/api/chat'] });
});

// Never crash on provider/LLM failures — log the full error server-side,
// return a generic message to the client (no internal path/stack leakage).
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[server error]', err.message);
  if (res.headersSent) {
    res.end();
    return;
  }
  res.status(500).json({ ok: false, error: 'internal error' });
});

export default app;
