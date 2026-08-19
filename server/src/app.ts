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
import { billingRouter, customerIsEntitled } from './routes/billing.js';
import { healthRouter } from './routes/health.js';
import { ledgerRouter } from './routes/ledger.js';
import { evaluationRouter, predictionsRouter } from './routes/predictions.js';
import { playerProfileRouter } from './routes/playerProfile.js';

const app = express();
const authConfig = loadAuthConfig();
app.set('trust proxy', process.env.VERCEL ? 1 : 2);
app.disable('x-powered-by');
app.use(securityHeaders(authConfig.production));
app.use(enforceTrustedOrigin(authConfig.allowedOrigins));

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

app.use('/api/auth/login', authLimiter, requireJsonRequest(), express.json({ limit: '8kb', type: 'application/json' }));
app.use(express.json({
  limit: '12mb',
  type: 'application/json',
  verify: (req, _res, buf) => { (req as { rawBody?: Buffer }).rawBody = buf; },
}));
app.use('/api', createAuthRouter(authConfig));
app.use(authenticateRequest(authConfig));
app.use(authenticatedNoStore);
app.use('/api/billing', billingRouter);
app.use('/api/chat', requireChatAccess, durableChatLimiter, chatLimiter);
app.use('/api/ledger', requireChatAccess, durableWriteLimiter, writeLimiter);
app.use('/api/predictions', durableWriteLimiter, writeLimiter);
app.use('/api', healthRouter);
app.use('/api', evaluationRouter);

export function requireChatAccess(req: Request, res: Response, next: NextFunction): void {
  if (req.auth) return next();
  const customerId = req.get('x-se-customer-id') || '';
  if (!customerId) {
    res.status(402).json({
      error: 'Start your free trial to unlock SportsEdge analysis.',
      code: 'SUBSCRIPTION_REQUIRED',
    });
    return;
  }
  customerIsEntitled(customerId)
    .then((entitled) => {
      if (!entitled) {
        res.status(402).json({
          error: 'An active subscription is required to use SportsEdge analysis.',
          code: 'SUBSCRIPTION_REQUIRED',
        });
        return;
      }
      (req as { auth?: unknown }).auth = { role: 'customer', userId: `cus:${customerId}` };
      next();
    })
    .catch(() => {
      res.status(402).json({ error: 'Could not verify subscription. Please try again.', code: 'SUBSCRIPTION_REQUIRED' });
    });
}

app.use('/api', requireChatAccess, chatRouter);
app.use('/api', requireChatAccess, ledgerRouter);
app.use('/api', requireChatAccess, playerProfileRouter);
app.use('/api', requireAuth, predictionsRouter);

app.get('/', (_req, res) => {
  res.json({
    name: 'sports-edge-server',
    version: '0.2.0',
    endpoints: [
      '/api/health',
      '/api/sources',
      '/api/auth/session',
      '/api/chat',
      '/api/ledger',
      '/api/player-profile',
      '/api/predictions',
    ],
  });
});

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
