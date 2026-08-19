import { Router, Request, Response } from 'express';
import { parseSportKey } from '../providers/playerAvailability.js';

export const playerProfileRouter = Router();

const ESPN_BASE = 'https://site.web.api.espn.com/apis/site/v2/sports';
const SPORT_PATH: Record<string, string> = {
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
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function flattenAthletes(raw: any[]): any[] {
  const out: any[] = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    if (Array.isArray(item?.items)) out.push(...item.items);
    else if (item?.id) out.push(item);
  }
  return out;
}

async function fetchJson(url: string): Promise<any> {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'SportsEdge/0.2 (+verified-player-profile)',
    },
  });
  if (!response.ok) throw new Error(`ESPN HTTP ${response.status}`);
  return response.json();
}

playerProfileRouter.get('/player-profile', async (req: Request, res: Response) => {
  const requestedName = String(req.query.name ?? '').trim();
  const sport = parseSportKey(String(req.query.sport ?? ''));
  if (!requestedName || !sport || !SPORT_PATH[sport]) {
    res.status(400).json({
      available: false,
      source: 'site.web.api.espn.com',
      checkedAt: new Date().toISOString(),
      reason: 'name and a supported sport (MLB/NFL/NBA/NHL) are required',
    } satisfies PlayerProfileResponse);
    return;
  }

  const cacheKey = `${sport}:${normalize(requestedName)}`;
  const hit = cache.get(cacheKey);
  if (hit && hit.expires > Date.now()) {
    res.json(hit.payload);
    return;
  }

  const checkedAt = new Date().toISOString();
  try {
    const path = SPORT_PATH[sport];
    const teamsJson = await fetchJson(`${ESPN_BASE}/${path}/teams`);
    const teams: any[] = teamsJson?.sports?.[0]?.leagues?.[0]?.teams ?? [];
    const target = normalize(requestedName);
    let resolved: PlayerProfileResponse['player'] | undefined;

    // Sequential on purpose: this endpoint is a display enhancement, and the
    // provider already caches the actual recommendation-eligibility checks.
    // Avoid blasting every league roster in parallel from one UI render.
    for (const wrapped of teams) {
      const team = wrapped?.team ?? wrapped;
      if (!team?.id) continue;
      try {
        const rosterJson = await fetchJson(`${ESPN_BASE}/${path}/teams/${team.id}/roster`);
        const athletes = flattenAthletes(rosterJson?.athletes ?? []);
        const athlete = athletes.find((candidate) => {
          const candidateName = normalize(String(candidate?.displayName ?? candidate?.fullName ?? ''));
          return candidateName === target;
        });
        if (!athlete) continue;
        resolved = {
          id: String(athlete.id),
          name: String(athlete.displayName ?? athlete.fullName ?? requestedName),
          teamId: String(team.id),
          teamName: String(team.displayName ?? team.name ?? ''),
          teamAbbreviation: String(team.abbreviation ?? ''),
          position: athlete?.position?.abbreviation ?? athlete?.position?.displayName ?? null,
          headshotUrl: typeof athlete?.headshot?.href === 'string' ? athlete.headshot.href : null,
        };
        break;
      } catch {
        // One team feed failing should not turn a cosmetic profile lookup into
        // a server error. Continue and report unavailable if nobody resolves.
      }
    }

    const payload: PlayerProfileResponse = resolved
      ? { available: true, source: 'site.web.api.espn.com', checkedAt, player: resolved }
      : {
          available: false,
          source: 'site.web.api.espn.com',
          checkedAt,
          reason: `No exact current-roster match for ${requestedName}`,
        };
    cache.set(cacheKey, { expires: Date.now() + CACHE_TTL_MS, payload });
    res.json(payload);
  } catch (error) {
    res.status(502).json({
      available: false,
      source: 'site.web.api.espn.com',
      checkedAt,
      reason: error instanceof Error ? error.message : 'ESPN profile lookup failed',
    } satisfies PlayerProfileResponse);
  }
});
