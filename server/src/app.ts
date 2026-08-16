// SportsEdge Express app (framework-agnostic — used by the local listener AND
// the Vercel serverless function via api/index.ts).

import express, { NextFunction, Request, Response } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import {
  authenticatedNoStore,
  authenticateRequest,
  createAuthRouter,
  createUserRateLimiter,
  enforceTrustedOrigin,
  loadAuthConfig,
  requireAuth,
  requireJsonRequest,
  securityHeaders,
} from './auth/index.js';
import { chatRouter } from './routes/chat.js';
import { healthRouter } from './routes/health.js';
import { ledgerRouter } from './routes/ledger.js';
import { evaluationRouter, predictionsRouter } from './routes/predictions.js';

const app = express();
const authConfig = loadAuthConfig();
// Vercel terminates TLS and forwards the real client IP. Trust exactly that
// first proxy hop so per-IP rate limiting does not collapse every visitor into
// the same bucket (or reject X-Forwarded-For as an unexpected header).
// Trust proxies so express-rate-limit accepts X-Forwarded-For (Tailscale
// funnel locally, Vercel edge in prod). Without this, funnel requests crash
// the limiter with ERR_ERL_UNEXPECTED_X_FORWARDED_FOR and take the server down.
app.set('trust proxy', true);
app.disable('x-powered-by');
app.use(securityHeaders(authConfig.production));
app.use(enforceTrustedOrigin(authConfig.allowedOrigins));

// Public deployment guard: cap per-IP abuse (LLM quota burn, ledger spam).
// This is best-effort per instance; use Vercel Firewall rate limits as the
// distributed production boundary when the project receives public traffic.
const chatLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.auth?.userId ? `user:${req.auth.userId}` : `ip:${ipKeyGenerator(req.ip ?? '')}`,
  message: { ok: false, error: 'Rate limit reached — try again in a few minutes.' },
});
const writeLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.auth?.userId ? `user:${req.auth.userId}` : `ip:${ipKeyGenerator(req.ip ?? '')}`,
  message: { ok: false, error: 'Rate limit reached — try again in a few minutes.' },
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { ok: false, error: 'Too many sign-in attempts. Try again later.' },
});
const durableChatLimiter = createUserRateLimiter({ scope: 'chat', windowMs: 10 * 60 * 1000, limit: 30 });
const durableWriteLimiter = createUserRateLimiter({ scope: 'writes', windowMs: 10 * 60 * 1000, limit: 60 });

// Parse the public login body under a much smaller limit before the larger
// screenshot-capable chat parser. Form bodies are intentionally unsupported.
app.use('/api/auth/login', authLimiter, requireJsonRequest(), express.json({ limit: '8kb', type: 'application/json' }));
app.use(express.json({ limit: '12mb', type: 'application/json' })); // attached screenshots (data URLs)
app.use('/api', createAuthRouter(authConfig));
app.use(authenticateRequest(authConfig));
app.use(authenticatedNoStore);
app.use('/api/chat', durableChatLimiter, chatLimiter);
app.use('/api/ledger', durableWriteLimiter, writeLimiter);
app.use('/api/predictions', durableWriteLimiter, writeLimiter);
app.use('/api', healthRouter);
app.use('/api', evaluationRouter);
app.use('/api', requireAuth, chatRouter);
app.use('/api', requireAuth, ledgerRouter);
app.use('/api', requireAuth, predictionsRouter);

app.get('/', (_req, res) => {
  res.json({ name: 'sports-edge-server', version: '0.2.0', endpoints: ['/api/health', '/api/sources', '/api/auth/session', '/api/chat', '/api/ledger', '/api/predictions'] });
});

// Never crash on provider/LLM failures — log the full error server-side,
// return a generic message to the client (no internal path/stack leakage).
app.use((err: Error & { status?: number; type?: string }, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[server error]', err.message);
  if (res.headersSent) {
    res.end();
    return;
  }
  if (err.status === 413) {
    res.status(413).json({ ok: false, error: 'Request body is too large.' });
    return;
  }
  if (err.status === 400 && err.type === 'entity.parse.failed') {
    res.status(400).json({ ok: false, error: 'Request body must contain valid JSON.' });
    return;
  }
  res.status(500).json({ ok: false, error: 'internal error' });
});

export default app;
