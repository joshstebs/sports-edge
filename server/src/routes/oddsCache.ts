import { Router } from 'express';
import { timingSafeEqual } from 'crypto';
import { warmSgoOddsCache } from '../providers/sportsGameOdds.js';

export const oddsCacheRouter = Router();

function cronAuthorized(header: string | undefined): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || !header?.startsWith('Bearer ')) return false;
  const supplied = header.slice('Bearer '.length);
  const expectedBuffer = Buffer.from(secret);
  const suppliedBuffer = Buffer.from(supplied);
  return (
    suppliedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(suppliedBuffer, expectedBuffer)
  );
}

// Pre-warms the SportsGameOdds prop-odds cache for today's slate so the
// game_odds tool returns verified prices instantly inside the 60s function
// budget (a full SGO walk can take 10-30s and would otherwise blow the budget).
// Called by Vercel Cron every 30 min during slate hours.
oddsCacheRouter.get('/odds-cache', async (req, res) => {
  if (!process.env.CRON_SECRET) {
    res.status(503).json({ ok: false, code: 'CRON_NOT_CONFIGURED', error: 'CRON_SECRET is required' });
    return;
  }
  if (!cronAuthorized(req.header('authorization'))) {
    res.status(401).json({ ok: false, code: 'UNAUTHORIZED', error: 'Invalid cron authorization' });
    return;
  }
  const sport = typeof req.query.sport === 'string' ? req.query.sport : 'mlb';
  try {
    const result = await warmSgoOddsCache(sport);
    res.json({ ok: true, sport, ...result, warmedAt: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ ok: false, error: (e as Error).message });
  }
});
