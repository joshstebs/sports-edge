import { Router } from 'express';
import { number, readConnector, record, string } from '../lib/workspaceConnector.js';
import { loadTrackingSnapshot } from '../lib/workspaceTracking.js';
import type { LineMovement, WorkspaceSnapshot } from '../workspace.js';

function parseMovements(value: unknown) {
  const payload = record(value);
  if (payload.success !== true) throw new Error('BetTrack request failed');
  const { movements, total } = record(payload.data);
  if (!Array.isArray(movements)) throw new Error('Missing movements');
  const rows: LineMovement[] = movements.slice(0, 30).map((value: unknown) => {
    const row = record(value);
    const game = record(row.game);
    const detectedAt = string(row.detectedAt);
    if (!Number.isFinite(Date.parse(detectedAt))) throw new Error('Invalid detection time');
    return {
      id: string(row.id),
      matchup: `${string(game.awayTeamName)} at ${string(game.homeTeamName)}`,
      market: string(row.marketType),
      type: string(row.movementType),
      detectedAt,
      average: number(row.averageMovement),
      books: number(row.bookmakerCount),
    };
  });
  return { movements: rows, total: number(total) };
}

export const workspaceRouter = Router();

workspaceRouter.get('/', async (req, res) => {
  const hours = req.query.hours ?? '24';
  if (hours !== '24' && hours !== '72' && hours !== '168') {
    res.status(400).json({ error: 'Choose a 24-hour, 72-hour or 7-day window' });
    return;
  }

  const { BETTRACK_URL, BETTRACK_API_KEY, BETIQ_URL } = process.env;
  const signal = AbortSignal.timeout(5000);
  const [markets, clv, model, bankroll] = await Promise.all([
    readConnector(BETTRACK_API_KEY ? BETTRACK_URL : undefined,
      `/api/mcp/analytics/movements/live?movementType=all&hoursBack=${hours}&limit=30`,
      parseMovements, signal, BETTRACK_API_KEY),
    readConnector(BETIQ_URL, '/api/health/clv-summary?days=30', (value) => {
      const data = record(value);
      if (data.error) throw new Error('BetIQ request failed');
      return {
        sample: number(data.n),
        beatClose: data.beat_close_pct == null ? null : number(data.beat_close_pct),
      };
    }, signal),
    readConnector(BETIQ_URL, '/api/health/model-status', (value) => {
      const data = record(value);
      if (!('current_version' in data)) throw new Error('Missing model status');
      return {
        version: data.current_version == null ? null
          : typeof data.current_version === 'number' ? number(data.current_version) : string(data.current_version),
        auc: data.holdout_auc == null ? null : number(data.holdout_auc),
      };
    }, signal),
    readConnector(BETIQ_URL, '/api/bankroll', (value) => {
      const data = record(value);
      return {
        balance: number(data.current_bankroll),
        growth: number(data.total_growth_pct),
        tracked: number(data.real_bets_tracked),
      };
    }, signal),
  ]);

  const snapshot: WorkspaceSnapshot = { markets, clv, model, bankroll };
  res.json(snapshot);
});

workspaceRouter.get('/tracking', async (req, res) => {
  const days = req.query.days ?? '30';
  if (days !== '7' && days !== '30' && days !== '90') {
    res.status(400).json({ error: 'Choose a 7-, 30- or 90-day comparison window' });
    return;
  }
  res.json(await loadTrackingSnapshot(req.auth!.userId, days));
});
