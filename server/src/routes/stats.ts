import { Router } from 'express';
import { getUnifiedInjuries, getUnifiedPlayerStats, type MultiSport } from '../providers/multiSportStats.js';

export const statsRouter = Router();

function sportParam(value: unknown): MultiSport | null {
  const sport = String(value ?? '').trim().toLowerCase();
  return sport === 'nba' || sport === 'nfl' || sport === 'nhl' ? sport : null;
}

statsRouter.get('/stats/player', async (req, res) => {
  const sport = sportParam(req.query.sport);
  const player = String(req.query.player ?? '').trim();
  if (!sport) {
    res.status(400).json({ ok: false, error: 'sport must be nba, nfl or nhl' });
    return;
  }
  if (!player) {
    res.status(400).json({ ok: false, error: 'player is required' });
    return;
  }
  const games = Math.min(Math.max(Number(req.query.games) || 10, 1), 20);
  try {
    const result = await getUnifiedPlayerStats(sport, player, games);
    res.status(result.available ? 200 : 503).json({ ok: result.available, ...result });
  } catch (error) {
    res.status(500).json({ ok: false, error: (error as Error).message });
  }
});

statsRouter.get('/stats/injuries', async (req, res) => {
  const sport = sportParam(req.query.sport);
  if (!sport) {
    res.status(400).json({ ok: false, error: 'sport must be nba, nfl or nhl' });
    return;
  }
  const player = String(req.query.player ?? '').trim() || undefined;
  try {
    const result = await getUnifiedInjuries(sport, player);
    res.status(result.available ? 200 : 503).json({ ok: result.available, ...result });
  } catch (error) {
    res.status(500).json({ ok: false, error: (error as Error).message });
  }
});
