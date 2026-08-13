// ESPN data provider — NFL + NBA (site.web.api.espn.com).
// IMPORTANT (verified live Aug 2026): site.api.espn.com is 403/Access-Denied
// from this network, but the SAME site/v2 API paths work on the
// site.web.api.espn.com host — all requests use that host.
//
//  - Teams list: GET /apis/site/v2/sports/{league}/teams
//  - Rosters:    GET /apis/site/v2/sports/{league}/teams/{teamId}/roster
//      NBA athletes[] = flat array; NFL athletes[] = position groups
//      {position, items[]} (offense/defense/specialTeam/...) — handle both.
//  - Gamelog:    GET /apis/common/v3/sports/{league}/athletes/{id}/gamelog
//      seasonTypes[].categories are MONTH splits (splitType april..october) —
//      union all eventIds, stats identical across categories; sort by
//      gameDate desc OURSELVES (ESPN order is not reliable). Composite stats
//      like '12-21' stay strings.
//  - Team stats: GET /apis/site/v2/sports/{league}/teams/{id}/statistics
//      NBA: pace estimated from FGA + 0.44*FTA - OReb + TOV (labeled).
//      NFL: yards/play = totalYards / totalOffensivePlays (labeled).
//      NFL defensive yards allowed are NOT exposed -> honest unavailable.

import { cacheGet, cacheSet, normalizeName, round } from './http.js';

const API = 'https://site.web.api.espn.com/apis/site/v2/sports';
const V3 = 'https://site.web.api.espn.com/apis/common/v3/sports';
const SOURCE = 'site.web.api.espn.com';
const CACHE_TTL = 30 * 60 * 1000;
const CONCURRENCY = 6;

export type EspnSport = 'basketball/nba' | 'football/nfl';

export interface TeamInfo {
  id: string;
  name: string;
  abbr: string;
}

// --- teams list -------------------------------------------------------------

export async function getTeams(sport: EspnSport): Promise<TeamInfo[]> {
  const key = `espn:teams:${sport}`;
  const cached = cacheGet<TeamInfo[]>(key, CACHE_TTL);
  if (cached) return cached;
  const j = await (await fetch(`${API}/${sport}/teams`, { headers: { 'User-Agent': UA() } })).json();
  const teams: TeamInfo[] = (j?.sports?.[0]?.leagues?.[0]?.teams ?? []).map((t: any) => ({
    id: String(t.team.id),
    name: t.team.displayName ?? t.team.name,
    abbr: t.team.abbreviation ?? '',
  }));
  cacheSet(key, teams);
  return teams;
}

// --- rosters ----------------------------------------------------------------

async function fetchRoster(sport: EspnSport, teamId: string): Promise<any[]> {
  const key = `espn:roster:${sport}:${teamId}`;
  const cached = cacheGet<any[]>(key, CACHE_TTL);
  if (cached) return cached;
  const res = await fetch(`${API}/${sport}/teams/${teamId}/roster`, {
    headers: { 'User-Agent': UA() },
  });
  if (!res.ok) throw new Error(`roster HTTP ${res.status} for team ${teamId}`);
  const j = await res.json();
  const athletes: any[] = j?.athletes ?? [];
  cacheSet(key, athletes);
  return athletes;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let idx = 0;
  const worker = async () => {
    while (idx < items.length) {
      const i = idx++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Flatten roster athletes into {id, displayName, position}. */
function flattenAthletes(athletes: any[]): Array<{ id: string; displayName: string; position: string }> {
  const out: Array<{ id: string; displayName: string; position: string }> = [];
  for (const a of athletes) {
    if (Array.isArray(a.items)) {
      // NFL: position group {position, items[]}
      for (const p of a.items) {
        out.push({ id: String(p.id), displayName: p.displayName ?? p.fullName ?? '', position: a.position ?? p.position ?? '' });
      }
    } else if (a.id) {
      // NBA: flat player objects
      out.push({ id: String(a.id), displayName: a.displayName ?? a.fullName ?? '', position: a.position?.abbreviation ?? '' });
    }
  }
  return out;
}

/** Find an athlete across all team rosters by name (parallel, cached rosters). */
export async function findPlayer(
  name: string,
  sport: EspnSport
): Promise<{ available: boolean; reason?: string; player?: { id: string; displayName: string; position: string; teamId: string; teamName: string } }> {
  try {
    const target = normalizeName(name);
    if (!target) return { available: false, reason: 'no player name provided' };
    const teams = await getTeams(sport);
    const all = await mapLimit(teams, CONCURRENCY, async (t) => {
      try {
        const athletes = await fetchRoster(sport, t.id);
        const flat = flattenAthletes(athletes);
        return flat.map((p) => ({ ...p, teamId: t.id, teamName: t.name }));
      } catch {
        return [];
      }
    });
    const flat = all.flat();
    let hit = flat.find((p) => normalizeName(p.displayName) === target);
    if (!hit) hit = flat.find((p) => normalizeName(p.displayName).includes(target));
    if (!hit) return { available: false, reason: `no "${name}" found in ${sport} rosters` };
    return {
      available: true,
      player: {
        id: hit.id,
        displayName: hit.displayName,
        position: hit.position,
        teamId: hit.teamId,
        teamName: hit.teamName,
      },
    };
  } catch (e) {
    return { available: false, reason: `ESPN lookup failed: ${(e as Error).message}` };
  }
}

// --- gamelog ----------------------------------------------------------------

export interface GameEntry {
  gameId: string;
  gameDate: string;
  opponent: string;
  atVs: string;
  score: string | null;
  result: string | null;
  stats: Record<string, string>;
}

export async function getGamelog(
  espnId: string,
  sport: EspnSport,
  limit = 10
): Promise<{ available: boolean; reason?: string; season?: string; games?: GameEntry[] }> {
  try {
    const url = `${V3}/${sport}/athletes/${espnId}/gamelog`;
    const j = await (await fetch(url, { headers: { 'User-Agent': UA() } })).json();
    const names: string[] = j?.names ?? [];
    const seasonTypes: any[] = j?.seasonTypes ?? [];
    const events: Record<string, any> = j?.events ?? {};
    const rs = seasonTypes.find((s) => /regular season/i.test(s.displayName ?? ''));
    if (!rs) return { available: false, reason: 'no Regular Season gamelog available' };

    const statsById = new Map<string, string[]>();
    for (const cat of rs.categories ?? []) {
      for (const e of cat.events ?? []) {
        if (e?.eventId && e?.stats && !statsById.has(String(e.eventId))) {
          statsById.set(String(e.eventId), e.stats);
        }
      }
    }
    const games: GameEntry[] = [];
    for (const [eventId, stats] of statsById.entries()) {
      const ev = events[eventId] ?? {};
      const rec: Record<string, string> = {};
      names.forEach((n, i) => {
        rec[n] = stats[i] ?? '';
      });
      games.push({
        gameId: eventId,
        gameDate: ev.gameDate ?? '',
        opponent: ev.opponent?.displayName ?? '',
        atVs: ev.atVs ?? '',
        score: ev.score ?? null,
        result: ev.gameResult ?? null,
        stats: rec,
      });
    }
    // ESPN ordering is unreliable -> sort by date desc ourselves
    games.sort((a, b) => (a.gameDate < b.gameDate ? 1 : a.gameDate > b.gameDate ? -1 : 0));
    const trimmed = games.slice(0, limit);
    return { available: true, season: rs.displayName, games: trimmed };
  } catch (e) {
    return { available: false, reason: `ESPN gamelog failed: ${(e as Error).message}` };
  }
}

// --- team statistics --------------------------------------------------------

export async function getTeamStats(
  sport: EspnSport,
  teamNameOrId: string
): Promise<{ available: boolean; reason?: string; sport?: string; team?: string; offense?: any; defense?: any; pace?: any; note?: string }> {
  try {
    const teams = await getTeams(sport);
    const t = teams.find((x) => x.id === teamNameOrId || normalizeName(x.name) === normalizeName(teamNameOrId));
    if (!t) return { available: false, reason: `team "${teamNameOrId}" not found` };
    const res = await fetch(`${API}/${sport}/teams/${t.id}/statistics`, {
      headers: { 'User-Agent': UA() },
    });
    if (!res.ok) {
      return { available: false, reason: `ESPN team statistics HTTP ${res.status} (endpoint unavailable)` };
    }
    const j = await res.json();
    const cats: any[] = j?.results?.stats?.categories ?? [];
    const statOf = (catName: string, statName: string): number | null => {
      const cat = cats.find((c) => c.name === catName);
      const s = cat?.stats?.find((x: any) => x.name === statName);
      const n = parseFloat(s?.value);
      return isNaN(n) ? null : n;
    };

    if (sport === 'basketball/nba') {
      const fga = statOf('offensive', 'avgFieldGoalsAttempted');
      const fta = statOf('offensive', 'avgFreeThrowsAttempted');
      const oreb = statOf('offensive', 'avgOffensiveRebounds');
      const tov = statOf('offensive', 'avgTurnovers');
      const ppg = statOf('offensive', 'avgPoints');
      const pace =
        fga !== null && fta !== null && oreb !== null && tov !== null
          ? round(fga + 0.44 * fta - oreb + tov, 1)
          : null;
      const ortg = pace && ppg !== null ? round((ppg / pace) * 100, 1) : null;
      return {
        available: true,
        sport: 'NBA',
        team: t.name,
        pace: {
          possessionsPerGame: pace,
          method: 'estimated possessions/game = FGA + 0.44*FTA - OReb + TOV (per team), from ESPN team stats',
        },
        offense: {
          pointsPerGame: ppg,
          offensiveRatingProxy: ortg,
          note: ortg ? 'offensive rating proxy = points per 100 estimated possessions' : undefined,
        },
        defense: {
          available: false,
          reason: 'ESPN team statistics endpoint does not expose opponent points (no defensive rating derivable)',
        },
        note: 'NBA 2025-26 season team stats (ESPN)',
      };
    }

    // NFL
    const totalYards = statOf('rushing', 'totalYards');
    const totalPlays = statOf('rushing', 'totalOffensivePlays');
    const ypp = totalYards !== null && totalPlays ? round(totalYards / totalPlays, 2) : null;
    return {
      available: true,
      sport: 'NFL',
      team: t.name,
      offense: {
        totalYards,
        totalOffensivePlays: totalPlays,
        yardsPerPlay: ypp,
        method: 'yards/play = totalYards / totalOffensivePlays (ESPN team stats)',
        yardsPerGame: statOf('passing', 'yardsPerGame'),
        passingYardsPerGame: statOf('passing', 'passingYardsPerGame'),
        rushingYardsPerGame: statOf('rushing', 'rushingYardsPerGame'),
        yardsPerPassAttempt: statOf('passing', 'yardsPerPassAttempt'),
        yardsPerRushAttempt: statOf('rushing', 'yardsPerRushAttempt'),
      },
      defense: {
        available: false,
        reason: 'ESPN team statistics endpoint does not expose defensive yards allowed',
      },
      note: 'NFL team stats (ESPN)',
    };
  } catch (e) {
    return { available: false, reason: `ESPN team stats failed: ${(e as Error).message}` };
  }
}

function UA(): string {
  return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
}

export const espnStatus = (sport: EspnSport) => ({
  baseUrl: `${API}/${sport}`,
  gamelogUrl: `${V3}/${sport}/athletes/{id}/gamelog`,
  available: true,
  note: 'host: site.web.api.espn.com (site.api.espn.com is 403-blocked from some networks; same API works on web.api)',
});
