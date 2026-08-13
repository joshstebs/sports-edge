// SportsEdge backend entrypoint. Loads .env FIRST, then Express app.

import 'dotenv/config';
import express, { NextFunction, Request, Response } from 'express';
import { chatRouter } from './routes/chat.js';
import { healthRouter } from './routes/health.js';
import { ledgerRouter } from './routes/ledger.js';
import { predictionsRouter } from './routes/predictions.js';

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.use('/api', healthRouter);
app.use('/api', chatRouter);
app.use('/api', ledgerRouter);
app.use('/api', predictionsRouter);

app.get('/', (_req, res) => {
  res.json({ name: 'sports-edge-server', version: '0.1.0', endpoints: ['/api/health', '/api/sources', '/api/chat'] });
});

// Never crash on provider/LLM failures — log and return a clean error.
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[server error]', err.message);
  if (res.headersSent) {
    res.end();
    return;
  }
  res.status(500).json({ ok: false, error: err.message || 'internal error' });
});

const PORT = Number(process.env.PORT) || 3100;
const server = app.listen(PORT, () => {
  console.log(`sports-edge-server listening on http://localhost:${PORT}`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
