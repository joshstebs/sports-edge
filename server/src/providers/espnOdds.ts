// ESPN odds provider — real sportsbook odds via ESPN's summary payload
// (site.web.api.espn.com). Verified live Aug 2026: the scoreboard carries no
// odds, but the per-event SUMMARY endpoint carries a `pickcenter` array with
// DraftKings odds: moneyline (open/close), point spread / runline, total,
// over/under prices. Keyless. Rate-limit: >=800ms between calls.

const SOURCE = 'site.web.api.espn.com (ESPN summary → DraftKings)';
const API = 'https://site.web.api.espn.com/apis/site/v2/sports';

const SPORT_PATHS: Record<string, string> = {
  mlb: 'baseball/mlb',
  nfl: 'football/nfl',
  nba: 'basketball/nba',
  nhl: 'hockey/nhl',
};

function UA(): string {
  return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}

export interface EspnOddsResult {
  available: boolean;
  reason?: string;
  source: string;
  provider: string | null;
  sport: string;
  eventId: string | null;
  away: string | null;
  home: string | null;
  moneyline: { away: string | null; home: string | null; awayOpen: string | null; homeOpen: string | null } | null;
  runline: { awayLine: string | null; awayOdds: string | null; homeLine: string | null; homeOdds: string | null } | null;
  total: { line: string | null; overOdds: string | null; underOdds: string | null; openLine: string | null } | null;
  retrievedAt: string;
}

let lastCall = 0;
async function pacedFetch(url: string): Promise<Response> {
  const wait = Math.max(0, lastCall + 800 - Date.now());
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    return await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': UA(), Accept: 'application/json' } });
  } finally {
    clearTimeout(t);
  }
}

async function getScoreboard(sportPath: string): Promise<Array<{ id: string; away: string; home: string }>> {
  const res = await pacedFetch(`${API}/${sportPath}/scoreboard`);
  if (!res.ok) throw new Error(`scoreboard HTTP ${res.status}`);
  const d: any = await res.json();
  return (d?.events ?? []).map((e: any) => {
    const comp = e?.competitions?.[0] ?? {};
    const teams: any[] = comp?.competitors ?? [];
    const away = teams.find((c) => c.homeAway === 'away')?.team?.displayName ?? null;
    const home = teams.find((c) => c.homeAway === 'home')?.team?.displayName ?? null;
    return { id: String(e.id), away, home };
  });
}

async function getSummaryOdds(eventId: string): Promise<any> {
  // pickcenter[0] = primary provider (DraftKings verified). Includes
  // moneyline/pointSpread/total with open + close prices.
  const res = await pacedFetch(`${API}/${SPORT_PATHS.mlb}/summary?event=${eventId}`);
  if (!res.ok) throw new Error(`summary HTTP ${res.status}`);
  const d: any = await res.json();
  const pc = Array.isArray(d?.pickcenter) ? d.pickcenter[0] : null;
  if (!pc) return null;
  return pc;
}

export async function getGameOdds(
  teamA?: string,
  teamB?: string,
  sportKey = 'mlb',
  _markets?: string[]
): Promise<EspnOddsResult> {
  const sport = SPORT_PATHS[sportKey.toLowerCase()];
  const bad: EspnOddsResult = {
    available: false, reason: '', source: SOURCE, provider: null,
    sport: sportKey, eventId: null, away: null, home: null,
    moneyline: null, runline: null, total: null, retrievedAt: new Date().toISOString(),
  };
  if (!sport) return { ...bad, reason: `unsupported sport "${sportKey}" (use mlb, nfl, nba or nhl)` };
  try {
    const events = await getScoreboard(sport);
    if (!events.length) return { ...bad, reason: 'no events on scoreboard' };

    let ev = events[0];
    if (teamA || teamB) {
      const a = norm(teamA ?? '');
      const b = norm(teamB ?? '');
      const hit = events.find((e) =>
        (!a || norm(e.away ?? '').includes(a) || norm(e.home ?? '').includes(a)) &&
        (!b || norm(e.away ?? '').includes(b) || norm(e.home ?? '').includes(b))
      );
      if (!hit) {
        return {
          ...bad,
          reason: `no scoreboard event matching "${teamA} vs ${teamB}" — check team names or game date`,
        };
      }
      ev = hit;
    }

    const pc = await getSummaryOdds(ev.id);
    if (!pc) {
      return {
        ...bad, eventId: ev.id, away: ev.away, home: ev.home,
        reason: 'summary has no odds yet (posts closer to game time)',
      };
    }

    const ml = pc.moneyline ?? null;
    const ps = pc.pointSpread ?? null;
    const tot = pc.total ?? null;
    return {
      available: true,
      source: SOURCE,
      provider: pc.provider?.name ?? null,
      sport: sportKey,
      eventId: ev.id,
      away: ev.away,
      home: ev.home,
      moneyline: ml
        ? {
            away: ml.away?.close?.odds ?? null,
            home: ml.home?.close?.odds ?? null,
            awayOpen: ml.away?.open?.odds ?? null,
            homeOpen: ml.home?.open?.odds ?? null,
          }
        : null,
      runline: ps
        ? {
            awayLine: ps.away?.close?.line ?? null,
            awayOdds: ps.away?.close?.odds ?? null,
            homeLine: ps.home?.close?.line ?? null,
            homeOdds: ps.home?.close?.odds ?? null,
          }
        : null,
      total: tot
        ? {
            line: tot.over?.close?.line ?? null,
            overOdds: tot.over?.close?.odds ?? null,
            underOdds: tot.under?.close?.odds ?? null,
            openLine: tot.over?.open?.line ?? null,
          }
        : null,
      retrievedAt: new Date().toISOString(),
    };
  } catch (e) {
    return { ...bad, reason: `ESPN odds fetch failed: ${(e as Error).message}` };
  }
}

/** Convenience: american odds string → number (e.g. "-105" → -105). */
export function parseAmerican(s: string | null | undefined): number | null {
  if (s == null) return null;
  const n = Number(s);
  return Number.isFinite(n) && n !== 0 ? n : null;
}
