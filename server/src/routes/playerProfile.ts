import { Router, Request, Response } from 'express';
import * as espn from '../providers/espn.js';
import { parseSportKey } from '../providers/playerAvailability.js';

export const playerProfileRouter = Router();

const ESPN_BASE = 'https://site.web.api.espn.com/apis/site/v2/sports';
const SPORT_PATH: Record<string, espn.EspnSport> = {
  mlb: 'baseball/mlb',
  nfl: 'football/nfl',
  nba: 'basketball/nba',
  nhl: 'hockey/nhl',
};
const CACHE_TTL_MS = 30 * 60 * 1000;
const cache = new Map<string, { expires: number; payload: PlayerProfileResponse }>();

interface PlayerProfileResponse {
  available: boolean;
  source: 'site.web.api.espn.com';
  checkedAt: string;
  player?: {
    id: string;
    name: string;
    teamId: string;
    teamName: string;
    teamAbbreviation: string;
    position: string | null;
    headshotUrl: string | null;
  };
  reason?: string;
}

function normalize(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function flattenAthletes(raw: any[]): any[] {
  const out: any[] = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    if (Array.isArray(item?.items)) out.push(...item.items);
    else if (item?.id) out.push(item);
  }
  return out;
}

playerProfileRouter.get('/player-profile', async (req: Request, res: Response) => {
  const requestedName = String(req.query.name ?? '').trim();
  const sport = parseSportKey(String(req.query.sport ?? ''));
  const path = sport ? SPORT_PATH[sport] : null;
  if (!requestedName || !sport || !path) {
    res.status(400).json({ available: false, source: 'site.web.api.espn.com', checkedAt: new Date().toISOString(), reason: 'name and a supported sport (MLB/NFL/NBA/NHL) are required' } satisfies PlayerProfileResponse);
    return;
  }

  const cacheKey = `${sport}:${normalize(requestedName)}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expires > Date.now()) {
    res.json(cached.payload);
    return;
  }

  const checkedAt = new Date().toISOString();
  try {
    // Reuse SportsEdge's league-wide cached roster resolver. Availability and
    // player research already call this provider, so profile rendering normally
    // adds only one team-roster request rather than another league-wide crawl.
    const found = await espn.findPlayer(requestedName, path);
    if (!found.available || !found.player) {
      const payload: PlayerProfileResponse = { available: false, source: 'site.web.api.espn.com', checkedAt, reason: found.reason ?? `No current-roster match for ${requestedName}` };
      cache.set(cacheKey, { expires: Date.now() + CACHE_TTL_MS, payload });
      res.json(payload);
      return;
    }

    const teams = await espn.getTeams(path);
    const team = teams.find((candidate) => candidate.id === found.player!.teamId);
    let headshotUrl: string | null = null;
    try {
      const rosterResponse = await fetch(`${ESPN_BASE}/${path}/teams/${encodeURIComponent(found.player.teamId)}/roster`, {
        headers: { Accept: 'application/json', 'User-Agent': 'SportsEdge/0.2 (+player-profile)' },
      });
      if (rosterResponse.ok) {
        const roster = await rosterResponse.json();
        const athlete = flattenAthletes(roster?.athletes ?? []).find((candidate) => String(candidate?.id ?? '') === found.player!.id);
        headshotUrl = typeof athlete?.headshot?.href === 'string' ? athlete.headshot.href : null;
      }
    } catch {
      // Headshot is optional. Identity still comes from the verified roster.
    }

    const payload: PlayerProfileResponse = {
      available: true,
      source: 'site.web.api.espn.com',
      checkedAt,
      player: {
        id: found.player.id,
        name: found.player.displayName,
        teamId: found.player.teamId,
        teamName: found.player.teamName,
        teamAbbreviation: team?.abbr ?? '',
        position: found.player.position || null,
        headshotUrl,
      },
    };
    cache.set(cacheKey, { expires: Date.now() + CACHE_TTL_MS, payload });
    res.json(payload);
  } catch (error) {
    res.status(502).json({ available: false, source: 'site.web.api.espn.com', checkedAt, reason: error instanceof Error ? error.message : 'ESPN profile lookup failed' } satisfies PlayerProfileResponse);
  }
});
