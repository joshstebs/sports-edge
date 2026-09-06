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

import { cacheGet, cacheSet, fetchJson, normalizeName, round } from './http.js';

const API = 'https://site.web.api.espn.com/apis/site/v2/sports';
const V3 = 'https://site.web.api.espn.com/apis/common/v3/sports';
const SOURCE = 'site.web.api.espn.com';
const CACHE_TTL = 30 * 60 * 1000;
const ROSTER_TTL = 5 * 60 * 1000;
const CONCURRENCY = 6;

export type EspnSport = 'baseball/mlb' | 'basketball/nba' | 'football/nfl' | 'hockey/nhl';

export interface TeamInfo {
  id: string;
  name: string;
  abbr: string;
}

export interface EspnRosterPlayer {
  id: string;
  displayName: string;
  position: string;
  rosterStatus: { name: string | null; type: string | null; abbreviation: string | null };
  injuries: Array<{ status: string | null; date: string | null; type: string | null; detail: string | null }>;
}

export interface EspnInjury {
  id: string;
  playerId: string;
  playerName: string;
  teamId: string | null;
  teamName: string | null;
  status: string;
  date: string | null;
  shortComment: string | null;
  longComment: string | null;
  type: string | null;
  detail: string | null;
  returnDate: string | null;
}

export interface EspnGameDayStatus {
  eventId: string;
  eventDate: string | null;
  state: string;
  status: string;
  completed: boolean;
  teams: Array<{ id: string; name: string }>;
  playerListedInEventInjuries: boolean;
  playerEventInjuryStatus: string | null;
  checkedAt: string;
}

// --- teams list -------------------------------------------------------------

export async function getTeams(sport: EspnSport): Promise<TeamInfo[]> {
  const key = `espn:teams:${sport}`;
  const cached = cacheGet<TeamInfo[]>(key, CACHE_TTL);
  if (cached) return cached;
  // Bounded: an unbounded fetch here stalled findPlayer()/roster discovery past
  // the tool timeout (espn.ts raw fetches previously had NO timeout at all).
  const res = await fetch(`${API}/${sport}/teams`, { headers: { 'User-Agent': UA() }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`teams HTTP ${res.status} for ${sport}`);
  const j = await res.json();
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
  const cached = cacheGet<any[]>(key, ROSTER_TTL);
  if (cached) return cached;
  const res = await fetch(`${API}/${sport}/teams/${teamId}/roster`, {
    headers: { 'User-Agent': UA() },
    signal: AbortSignal.timeout(8000),
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
function readRosterPlayer(p: any, groupPosition = ''): EspnRosterPlayer {
  const status = p?.status ?? {};
  return {
    id: String(p?.id ?? ''),
    displayName: p?.displayName ?? p?.fullName ?? '',
    position: p?.position?.abbreviation ?? p?.position?.displayName ?? groupPosition ?? '',
    rosterStatus: {
      name: status?.name ?? null,
      type: status?.type ?? null,
      abbreviation: status?.abbreviation ?? null,
    },
    injuries: (Array.isArray(p?.injuries) ? p.injuries : []).map((i: any) => ({
      status: i?.status ?? null,
      date: i?.date ?? null,
      type: i?.details?.type ?? null,
      detail: i?.details?.detail ?? null,
    })),
  };
}

function flattenAthletes(athletes: any[]): EspnRosterPlayer[] {
  const out: EspnRosterPlayer[] = [];
  for (const a of athletes) {
    if (Array.isArray(a.items)) {
      // NFL: position group {position, items[]}
      for (const p of a.items) {
        out.push(readRosterPlayer(p, a.position ?? ''));
      }
    } else if (a.id) {
      // NBA/MLB/NHL: flat player objects
      out.push(readRosterPlayer(a));
    }
  }
  return out;
}

/** Find an athlete across all team rosters by name (parallel, cached rosters). */
export async function findPlayer(
  name: string,
  sport: EspnSport
): Promise<{
  available: boolean;
  reason?: string;
  coverage?: { teams: number; succeeded: number; failed: number };
  player?: EspnRosterPlayer & { teamId: string; teamName: string };
}> {
  try {
    const target = normalizeName(name);
    if (!target) return { available: false, reason: 'no player name provided' };
    const teams = await getTeams(sport);
    let succeeded = 0;
    const all = await mapLimit(teams, CONCURRENCY, async (t) => {
      try {
        const athletes = await fetchRoster(sport, t.id);
        succeeded++;
        const flat = flattenAthletes(athletes);
        return flat.map((p) => ({ ...p, teamId: t.id, teamName: t.name }));
      } catch {
        return [];
      }
    });
    const flat = all.flat();
    let hit = flat.find((p) => normalizeName(p.displayName) === target);
    if (!hit) hit = flat.find((p) => normalizeName(p.displayName).includes(target));
    const coverage = { teams: teams.length, succeeded, failed: teams.length - succeeded };
    if (!hit) return { available: false, reason: `no "${name}" found in ${sport} rosters`, coverage };
    return {
      available: true,
      coverage,
      player: {
        ...hit,
        teamId: hit.teamId,
        teamName: hit.teamName,
      },
    };
  } catch (e) {
    return { available: false, reason: `ESPN lookup failed: ${(e as Error).message}` };
  }
}

// --- league injury reports -------------------------------------------------

/** Current ESPN league injury report. This is separate from roster status:
 * ESPN commonly leaves an injured player's roster status as "Active" while
 * publishing Out/Questionable/Day-To-Day on this feed. */
export async function getLeagueInjuries(
  sport: EspnSport
): Promise<{ available: boolean; reason?: string; source: string; checkedAt: string; injuries: EspnInjury[] }> {
  const key = `espn:injuries:${sport}`;
  const cached = cacheGet<{ checkedAt: string; injuries: EspnInjury[] }>(key, 5 * 60 * 1000);
  if (cached) return { available: true, source: SOURCE, ...cached };
  const checkedAt = new Date().toISOString();
  try {
    const j = await fetchJson(`${API}/${sport}/injuries`);
    if (!Array.isArray(j?.injuries)) {
      return { available: false, reason: 'ESPN injury response did not include an injury list', source: SOURCE, checkedAt, injuries: [] };
    }
    const injuries: EspnInjury[] = [];
    for (const team of j.injuries) {
      for (const i of Array.isArray(team?.injuries) ? team.injuries : []) {
        const athlete = i?.athlete ?? {};
        const playerName = String(athlete?.displayName ?? athlete?.fullName ?? '').trim();
        if (!playerName) continue;
        injuries.push({
          id: String(i?.id ?? ''),
          playerId: String(athlete?.id ?? ''),
          playerName,
          teamId: athlete?.team?.id != null ? String(athlete.team.id) : team?.id != null ? String(team.id) : null,
          teamName: athlete?.team?.displayName ?? team?.displayName ?? null,
          status: String(i?.status ?? 'Unknown'),
          date: i?.date ?? null,
          shortComment: i?.shortComment ?? null,
          longComment: i?.longComment ?? null,
          type: i?.details?.type ?? null,
          detail: i?.details?.detail ?? null,
          returnDate: i?.details?.returnDate ?? null,
        });
      }
    }
    cacheSet(key, { checkedAt, injuries });
    return { available: true, source: SOURCE, checkedAt, injuries };
  } catch (e) {
    return { available: false, reason: `ESPN injury report failed: ${(e as Error).message}`, source: SOURCE, checkedAt, injuries: [] };
  }
}

// --- event-specific game-day status ---------------------------------------

/** Resolve one exact scheduled event and re-check its event injury report.
 * Absence from the league feed alone is not enough for a game-day prop: late
 * scratches are often attached to the event summary closer to lock. */
export async function getGameDayStatus(
  sport: EspnSport,
  playerName: string,
  teamId: string,
  date: string,
  eventId?: string | number | null,
): Promise<{ available: boolean; reason?: string; source: string; data?: EspnGameDayStatus }> {
  const checkedAt = new Date().toISOString();
  const day = date.replace(/-/g, '');
  if (!/^\d{8}$/.test(day)) return { available: false, reason: `invalid event date "${date}"`, source: SOURCE };
  try {
    const scoreboard = await fetchJson(`${API}/${sport}/scoreboard?dates=${day}`);
    const events: any[] = Array.isArray(scoreboard?.events) ? scoreboard.events : [];
    const requestedId = eventId != null && String(eventId).trim() ? String(eventId).trim() : null;
    const teamEvents = events.filter((event) =>
      (event?.competitions?.[0]?.competitors ?? []).some((c: any) => String(c?.team?.id ?? '') === String(teamId))
    );
    const matches = requestedId ? events.filter((event) => String(event?.id ?? '') === requestedId) : teamEvents;
    if (matches.length !== 1) {
      return {
        available: false,
        reason: requestedId
          ? `event ${requestedId} was not found exactly once on ${date}`
          : teamEvents.length > 1
            ? `multiple events found for team ${teamId} on ${date}; exact eventId required`
            : `no event found for team ${teamId} on ${date}`,
        source: SOURCE,
      };
    }
    const event = matches[0];
    const competitors: any[] = event?.competitions?.[0]?.competitors ?? [];
    if (!competitors.some((c) => String(c?.team?.id ?? '') === String(teamId))) {
      return { available: false, reason: `event ${event.id} does not include the player's current team`, source: SOURCE };
    }
    const type = event?.status?.type ?? {};
    const state = String(type?.state ?? '').toLowerCase();
    const completed = type?.completed === true;
    if (state !== 'pre' || completed) {
      return {
        available: false,
        reason: `event ${event.id} is ${(type?.detail ?? type?.name ?? state) || 'not in a pregame state'}`,
        source: SOURCE,
      };
    }

    const summary = await fetchJson(`${API}/${sport}/summary?event=${encodeURIComponent(String(event.id))}`);
    if (!Array.isArray(summary?.injuries)) {
      return { available: false, reason: `event ${event.id} injury report is unavailable`, source: SOURCE };
    }
    const target = normalizeName(playerName);
    const eventInjuries: any[] = summary.injuries.flatMap((group: any) => Array.isArray(group?.injuries) ? group.injuries : []);
    const hit = eventInjuries.find((injury: any) =>
      normalizeName(injury?.athlete?.displayName ?? injury?.athlete?.fullName ?? '') === target
    );
    return {
      available: true,
      source: SOURCE,
      data: {
        eventId: String(event.id),
        eventDate: event?.date ?? null,
        state,
        status: String(type?.detail ?? type?.name ?? 'pregame'),
        completed,
        teams: competitors.map((c) => ({ id: String(c?.team?.id ?? ''), name: c?.team?.displayName ?? c?.team?.name ?? '' })),
        playerListedInEventInjuries: Boolean(hit),
        playerEventInjuryStatus: hit ? String(hit?.status ?? hit?.type?.description ?? 'Unknown') : null,
        checkedAt,
      },
    };
  } catch (e) {
    return { available: false, reason: `ESPN game-day status failed: ${(e as Error).message}`, source: SOURCE };
  }
}

// --- final event result ----------------------------------------------------

export interface EspnEventResult {
  eventId: string;
  date: string | null;
  completed: boolean;
  status: string;
  away: { id: string; name: string; score: number | null };
  home: { id: string; name: string; score: number | null };
}

export async function getEventResult(
  sport: EspnSport,
  date: string,
  eventId?: string | number | null,
  teamA?: string | null,
  teamB?: string | null,
): Promise<{ available: boolean; reason?: string; source: string; result?: EspnEventResult }> {
  const day = String(date ?? '').replace(/-/g, '');
  if (!/^\d{8}$/.test(day)) return { available: false, reason: 'invalid event date', source: SOURCE };
  try {
    const scoreboard = await fetchJson(`${API}/${sport}/scoreboard?dates=${day}`);
    const events: any[] = Array.isArray(scoreboard?.events) ? scoreboard.events : [];
    const requestedId = eventId != null && String(eventId).trim() ? String(eventId).trim() : null;
    let matches = requestedId
      ? events.filter((event) => String(event?.id ?? '') === requestedId)
      : events;
    if (!requestedId && (teamA || teamB)) {
      const a = normalizeName(String(teamA ?? ''));
      const b = normalizeName(String(teamB ?? ''));
      matches = events.filter((event) => {
        const competitors: any[] = event?.competitions?.[0]?.competitors ?? [];
        const names = competitors.map((row) => normalizeName(String(row?.team?.displayName ?? row?.team?.name ?? '')));
        const hasA = !a || names.some((name) => name === a || name.includes(a) || a.includes(name));
        const hasB = !b || names.some((name) => name === b || name.includes(b) || b.includes(name));
        return hasA && hasB;
      });
    }
    if (matches.length !== 1) {
      return { available: false, reason: matches.length ? 'multiple matching events; exact eventId required' : 'event not found on scoreboard', source: SOURCE };
    }
    const event = matches[0];
    const competitors: any[] = event?.competitions?.[0]?.competitors ?? [];
    const away = competitors.find((row) => row?.homeAway === 'away') ?? competitors[0] ?? {};
    const home = competitors.find((row) => row?.homeAway === 'home') ?? competitors[1] ?? {};
    const score = (row: any): number | null => {
      const value = Number(row?.score);
      return Number.isFinite(value) ? value : null;
    };
    const type = event?.status?.type ?? {};
    return {
      available: true,
      source: SOURCE,
      result: {
        eventId: String(event?.id ?? ''),
        date: event?.date ?? null,
        completed: type?.completed === true || String(type?.state ?? '').toLowerCase() === 'post',
        status: String(type?.detail ?? type?.description ?? type?.name ?? type?.state ?? ''),
        away: { id: String(away?.team?.id ?? ''), name: String(away?.team?.displayName ?? away?.team?.name ?? ''), score: score(away) },
        home: { id: String(home?.team?.id ?? ''), name: String(home?.team?.displayName ?? home?.team?.name ?? ''), score: score(home) },
      },
    };
  } catch (error) {
    return { available: false, reason: 'ESPN scoreboard result failed: ' + (error as Error).message, source: SOURCE };
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
    // Bounded fetch: this gamelog feeds the NBA/NFL/NHL screener directly.
    const j = await (await fetch(url, { headers: { 'User-Agent': UA() }, signal: AbortSignal.timeout(8000) })).json();
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
      signal: AbortSignal.timeout(8000),
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
