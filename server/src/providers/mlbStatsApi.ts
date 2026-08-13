// MLB Stats API (statsapi.mlb.com) — keyless.
// Quirks handled (verified live):
//  - people/search takes ONE name per call (comma batches return 0 people).
//  - gameLog is OLDEST-first -> reverse for recent-first.
//  - pitching K field is `strikeOuts` (capital O).
//  - statSplits may return MULTIPLE splits per sitCode -> take the max-IP one.
//  - batting gameLog splits: filter to atBats > 0; pitching: gamesStarted == 1.
//  - abstractGameState: Preview -> Scheduled, Live -> In Progress, Final -> Final.

import { fetchJson, normalizeName } from './http.js';

const BASE = 'https://statsapi.mlb.com/api/v1';
export const CURRENT_SEASON = '2026';
const SOURCE = 'statsapi.mlb.com';

export interface ProviderResult<T> {
  available: boolean;
  reason?: string;
  source: string;
  data?: T;
}

function fail<T>(reason: string): ProviderResult<T> {
  return { available: false, reason, source: SOURCE };
}

// --- player lookup ----------------------------------------------------------

export async function searchPlayer(name: string): Promise<ProviderResult<{ id: number; fullName: string }>> {
  try {
    if (!name || !name.trim()) return fail('no player name provided');
    const j = await fetchJson(`${BASE}/people/search?names=${encodeURIComponent(name.trim())}`);
    const people: any[] = j?.people ?? [];
    if (!people.length) return fail(`no player found for "${name}"`);
    const p = people[0];
    return { available: true, source: SOURCE, data: { id: p.id, fullName: p.fullName } };
  } catch (e) {
    return fail(`search failed: ${(e as Error).message}`);
  }
}

// --- season stats -----------------------------------------------------------

export async function getSeasonStats(
  playerId: number,
  group: 'hitting' | 'pitching',
  season: string = CURRENT_SEASON
): Promise<ProviderResult<any>> {
  try {
    const j = await fetchJson(
      `${BASE}/people/${playerId}/stats?stats=season&season=${season}&group=${group}`
    );
    const split = j?.stats?.[0]?.splits?.[0];
    if (!split?.stat) return fail(`no ${season} ${group} season stats for player ${playerId}`);
    return { available: true, source: SOURCE, data: { season, split } };
  } catch (e) {
    return fail(`season stats failed: ${(e as Error).message}`);
  }
}

// --- game log (recent-first) ------------------------------------------------

export async function getGameLog(
  playerId: number,
  group: 'hitting' | 'pitching',
  season: string = CURRENT_SEASON,
  limit?: number
): Promise<ProviderResult<any[]>> {
  try {
    const j = await fetchJson(
      `${BASE}/people/${playerId}/stats?stats=gameLog&season=${season}&group=${group}`
    );
    const splits: any[] = j?.stats?.[0]?.splits ?? [];
    if (!splits.length) return fail(`no ${season} game log for player ${playerId}`);
    // oldest-first -> reverse; drop today's in-progress split; filter by group rules
    let filtered = splits.filter((s) => {
      if (group === 'hitting') return (s.stat?.atBats ?? 0) > 0;
      return (s.stat?.gamesStarted ?? 0) === 1;
    });
    filtered = filtered.reverse();
    if (limit && filtered.length > limit) filtered = filtered.slice(0, limit);
    return { available: true, source: SOURCE, data: filtered };
  } catch (e) {
    return fail(`game log failed: ${(e as Error).message}`);
  }
}

// --- platoon splits (statSplits) --------------------------------------------

export async function getPlatoonSplits(
  playerId: number,
  group: 'hitting' | 'pitching',
  season: string = CURRENT_SEASON
): Promise<ProviderResult<any[]>> {
  try {
    const j = await fetchJson(
      `${BASE}/people/${playerId}/stats?stats=statSplits&sitCodes=vl,vr&group=${group}&season=${season}`
    );
    const splits: any[] = j?.stats?.[0]?.splits ?? [];
    if (!splits.length) return fail(`no platoon splits for player ${playerId}`);
    // multiple splits can share a code (home/away/... variants) -> keep max IP/PA per code
    const byCode = new Map<string, any>();
    for (const s of splits) {
      const code: string = s.split?.code ?? '?';
      const cur = byCode.get(code);
      const size = group === 'pitching' ? parseFloat(s.stat?.inningsPitched ?? '0') : s.stat?.plateAppearances ?? 0;
      const curSize = cur ? (group === 'pitching' ? parseFloat(cur.stat?.inningsPitched ?? '0') : cur.stat?.plateAppearances ?? 0) : -1;
      if (!cur || size > curSize) byCode.set(code, s);
    }
    const out = [...byCode.entries()].map(([code, s]) => ({
      code,
      description: s.split?.description ?? code,
      ...pickSplitStat(s.stat, group),
    }));
    return { available: true, source: SOURCE, data: out };
  } catch (e) {
    return fail(`platoon splits failed: ${(e as Error).message}`);
  }
}

function pickSplitStat(stat: any, group: 'hitting' | 'pitching') {
  if (group === 'pitching') {
    return {
      inningsPitched: stat?.inningsPitched ?? null,
      strikeOuts: stat?.strikeOuts ?? 0,
      baseOnBalls: stat?.baseOnBalls ?? 0,
      hits: stat?.hits ?? 0,
      homeRuns: stat?.homeRuns ?? 0,
      avg: stat?.avg ?? null,
      whip: stat?.whip ?? null,
      era: stat?.era ?? null,
      kPer9: stat?.inningsPitched ? round9(stat.strikeOuts, stat.inningsPitched) : null,
      kPercent: stat?.plateAppearances ? (100 * stat.strikeOuts) / stat.plateAppearances : null,
      bbPercent: stat?.plateAppearances ? (100 * stat.baseOnBalls) / stat.plateAppearances : null,
    };
  }
  return {
    plateAppearances: stat?.plateAppearances ?? 0,
    atBats: stat?.atBats ?? 0,
    hits: stat?.hits ?? 0,
    doubles: stat?.doubles ?? 0,
    triples: stat?.triples ?? 0,
    homeRuns: stat?.homeRuns ?? 0,
    rbi: stat?.rbi ?? 0,
    baseOnBalls: stat?.baseOnBalls ?? 0,
    strikeOuts: stat?.strikeOuts ?? 0,
    avg: stat?.avg ?? null,
    ops: stat?.ops ?? null,
    kPercent: stat?.plateAppearances ? (100 * stat.strikeOuts) / stat.plateAppearances : null,
  };
}

function round9(k: number, ip: string): number {
  const inn = parseFloat(ip);
  if (!inn) return 0;
  return Math.round((k * 9 * 100) / inn) / 100;
}

// --- schedule ---------------------------------------------------------------

export interface MlGame {
  gamePk: number;
  gameDate: string;
  officialDate: string;
  status: string;
  detailedState: string;
  away: { id: number; name: string };
  home: { id: number; name: string };
  awayProbable?: string | null;
  homeProbable?: string | null;
  venue?: string | null;
}

const STATE_MAP: Record<string, string> = {
  Preview: 'Scheduled',
  Live: 'In Progress',
  Final: 'Final',
};

export async function getSchedule(
  startDate: string,
  endDate: string
): Promise<ProviderResult<MlGame[]>> {
  try {
    const j = await fetchJson(
      `${BASE}/schedule?sportId=1&startDate=${startDate}&endDate=${endDate}&hydrate=probablePitcher,team,venue`
    );
    const games: MlGame[] = [];
    for (const d of j?.dates ?? []) {
      for (const g of d.games ?? []) {
        const abstract = g.status?.abstractGameState ?? 'Preview';
        games.push({
          gamePk: g.gamePk,
          gameDate: g.gameDate,
          officialDate: g.officialDate ?? d.date,
          status: STATE_MAP[abstract] ?? abstract,
          detailedState: g.status?.detailedState ?? abstract,
          away: { id: g.teams?.away?.team?.id, name: g.teams?.away?.team?.name },
          home: { id: g.teams?.home?.team?.id, name: g.teams?.home?.team?.name },
          awayProbable: g.teams?.away?.probablePitcher?.fullName ?? null,
          homeProbable: g.teams?.home?.probablePitcher?.fullName ?? null,
          venue: g.venue?.name ?? null,
        });
      }
    }
    if (!games.length) return fail(`no games between ${startDate} and ${endDate}`);
    return { available: true, source: SOURCE, data: games };
  } catch (e) {
    return fail(`schedule failed: ${(e as Error).message}`);
  }
}

// --- boxscore lineups -------------------------------------------------------

export async function getLineups(gamePk: number): Promise<ProviderResult<any>> {
  try {
    const j = await fetchJson(`${BASE}/game/${gamePk}/boxscore`);
    const teams = j?.teams ?? {};
    const players: Record<string, any> = j?.players ?? {};
    const read = (side: 'away' | 'home') => {
      const t = teams[side] ?? {};
      const order = (t.battingOrder ?? []).map((id: string) => {
        const p = players[`ID${id}`];
        return { id, fullName: p?.person?.fullName ?? `#${id}` };
      });
      const prob = t.probablePitcher
        ? { id: t.probablePitcher.id, fullName: t.probablePitcher.fullName }
        : null;
      const pitchers = Object.values(t.pitchers ?? {}).map((p: any) => ({
        id: p?.person?.id,
        fullName: p?.person?.fullName ?? p?.person?.fullName ?? null,
      }));
      return {
        team: { id: t.team?.id, name: t.team?.name },
        battingOrder: order,
        lineupsPosted: order.length > 0,
        probablePitcher: prob,
        pitchers,
      };
    };
    const out = {
      gamePk,
      status: j?.status?.abstractGameState ?? null,
      away: read('away'),
      home: read('home'),
    };
    if (!out.away.battingOrder.length && !out.home.battingOrder.length) {
      out.away.lineupsPosted = false;
      out.home.lineupsPosted = false;
    }
    return { available: true, source: SOURCE, data: out };
  } catch (e) {
    return fail(`boxscore failed: ${(e as Error).message}`);
  }
}

// --- team name matching -----------------------------------------------------

const TEAM_NAMES: [string, string][] = [
  ['Arizona Diamondbacks', 'Diamondbacks'],
  ['Atlanta Braves', 'Braves'],
  ['Baltimore Orioles', 'Orioles'],
  ['Boston Red Sox', 'Red Sox'],
  ['Chicago Cubs', 'Cubs'],
  ['Chicago White Sox', 'White Sox'],
  ['Cincinnati Reds', 'Reds'],
  ['Cleveland Guardians', 'Guardians'],
  ['Colorado Rockies', 'Rockies'],
  ['Detroit Tigers', 'Tigers'],
  ['Houston Astros', 'Astros'],
  ['Kansas City Royals', 'Royals'],
  ['Los Angeles Angels', 'Angels'],
  ['Los Angeles Dodgers', 'Dodgers'],
  ['Miami Marlins', 'Marlins'],
  ['Milwaukee Brewers', 'Brewers'],
  ['Minnesota Twins', 'Twins'],
  ['New York Mets', 'Mets'],
  ['New York Yankees', 'Yankees'],
  ['Oakland Athletics', 'Athletics'],
  ['Philadelphia Phillies', 'Phillies'],
  ['Pittsburgh Pirates', 'Pirates'],
  ['San Diego Padres', 'Padres'],
  ['San Francisco Giants', 'Giants'],
  ['Seattle Mariners', 'Mariners'],
  ['St. Louis Cardinals', 'Cardinals'],
  ['Tampa Bay Rays', 'Rays'],
  ['Texas Rangers', 'Rangers'],
  ['Toronto Blue Jays', 'Blue Jays'],
  ['Washington Nationals', 'Nationals'],
];

/** Match a user-supplied team string to a canonical full name (e.g. "Blue Jays"). */
export function matchTeamName(query: string): string | null {
  const q = normalizeName(query);
  if (!q) return null;
  for (const [full, nick] of TEAM_NAMES) {
    const f = normalizeName(full);
    const n = normalizeName(nick);
    if (q === f || q === n) return full;
    if (f.includes(q) || q.includes(f) || n.includes(q) || q.includes(n)) return full;
  }
  return null;
}
