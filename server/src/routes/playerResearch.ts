import { Router, Request, Response } from 'express';
import * as espn from '../providers/espn.js';
import * as mlb from '../providers/mlbStatsApi.js';
import { parseSportKey } from '../providers/playerAvailability.js';
import { espnObservation, mlbObservation, normalizeMarket } from '../models/playerPropModel.js';

export const playerResearchRouter = Router();

const ESPN_SPORTS: Record<'nfl' | 'nba' | 'nhl', espn.EspnSport> = {
  nfl: 'football/nfl',
  nba: 'basketball/nba',
  nhl: 'hockey/nhl',
};

playerResearchRouter.get('/player-research', async (req: Request, res: Response) => {
  const player = String(req.query.name ?? '').trim();
  const sport = parseSportKey(String(req.query.sport ?? ''));
  const market = normalizeMarket(String(req.query.market ?? '').trim());
  const requestedLimit = Number(req.query.limit ?? 10);
  const limit = Math.max(3, Math.min(20, Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 10));

  if (!player || !sport || !market) {
    res.status(400).json({
      available: false,
      reason: 'name, supported sport (MLB/NFL/NBA/NHL), and market are required',
    });
    return;
  }

  try {
    if (sport === 'mlb') {
      const found = await mlb.searchPlayer(player);
      if (!found.available || !found.data) {
        res.status(404).json({ available: false, reason: found.reason ?? 'official MLB player not found' });
        return;
      }
      const pitcherMarkets = new Set(['strikeouts', 'earnedRuns', 'hitsAllowed', 'walksAllowed', 'outsRecorded']);
      const group = pitcherMarkets.has(market) ? 'pitching' : 'hitting';
      const log = await mlb.getGameLog(found.data.id, group, mlb.CURRENT_SEASON, limit);
      if (!log.available || !Array.isArray(log.data)) {
        res.status(502).json({ available: false, reason: log.reason ?? 'official MLB game log unavailable' });
        return;
      }
      const observations = log.data.flatMap((game: any) => {
        const value = mlbObservation(market, game.stat ?? {});
        if (value == null || !Number.isFinite(value)) return [];
        return [{
          date: game.date ?? null,
          value,
          opponent: game.opponent ?? game.opponentName ?? null,
          result: game.result ?? null,
          gameId: game.gamePk != null ? String(game.gamePk) : null,
        }];
      });
      res.json({
        available: observations.length > 0,
        source: 'statsapi.mlb.com official gameLog',
        sport: 'MLB',
        player: found.data.fullName,
        playerId: String(found.data.id),
        market,
        season: mlb.CURRENT_SEASON,
        observations,
        reason: observations.length ? undefined : `No published ${market} values in the requested MLB game log window.`,
      });
      return;
    }

    const espnSport = ESPN_SPORTS[sport];
    const found = await espn.findPlayer(player, espnSport);
    if (!found.available || !found.player) {
      res.status(404).json({ available: false, reason: found.reason ?? 'current ESPN roster player not found' });
      return;
    }
    const log = await espn.getGamelog(found.player.id, espnSport, limit);
    if (!log.available || !Array.isArray(log.games)) {
      res.status(502).json({ available: false, reason: log.reason ?? 'official ESPN game log unavailable' });
      return;
    }
    const observations = log.games.flatMap((game) => {
      const value = espnObservation(sport, market, game.stats);
      if (value == null || !Number.isFinite(value)) return [];
      return [{
        date: game.gameDate || null,
        value,
        opponent: game.opponent || null,
        result: game.result || null,
        gameId: game.gameId || null,
      }];
    });
    res.json({
      available: observations.length > 0,
      source: 'site.web.api.espn.com v3 official game log',
      sport: sport.toUpperCase(),
      player: found.player.displayName,
      playerId: found.player.id,
      team: found.player.teamName,
      position: found.player.position,
      market,
      season: log.season ?? null,
      observations,
      reason: observations.length ? undefined : `No published ${market} values in the requested ESPN game log window.`,
    });
  } catch (error) {
    res.status(502).json({
      available: false,
      reason: error instanceof Error ? error.message : 'player research lookup failed',
    });
  }
});
