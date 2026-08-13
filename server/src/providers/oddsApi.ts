// The Odds API v4 — classic platform, key passed as ?apiKey= QUERY PARAM
// (x-api-key header FAILS on classic platform). Optional: everything returns
// {available:false} unless ODDS_API_KEY is set.
//  - Featured markets (h2h,spreads,totals) work on free plans.
//  - Player props need a Business plan -> separate call per event; a failed
//    props call (INVALID_MARKET) is caught and marked unavailable — NEVER faked.
//  - Event-odds endpoint returns a single OBJECT, not a list.
//  - h2h outcome names are team names. commence_time is UTC vs local game
//    dates -> match by normalized team names + |julianday diff| < 0.5.
//  - Track x-requests-remaining; skip pulls when remaining < 50.

import { normalizeName } from './http.js';

const BASE = 'https://api.the-odds-api.com/v4';
const SOURCE = 'api.the-odds-api.com';

const SPORT_KEYS: Record<string, string> = {
  mlb: 'baseball_mlb',
  baseball: 'baseball_mlb',
  nfl: 'americanfootball_nfl',
  football: 'americanfootball_nfl',
  nba: 'basketball_nba',
  basketball: 'basketball_nba',
};

let remaining: number | null = null;

export function oddsConfigured(): boolean {
  return Boolean(process.env.ODDS_API_KEY);
}

export function quotaRemaining(): number | null {
  return remaining;
}

function key(): string | null {
  return process.env.ODDS_API_KEY ?? null;
}

async function getJson(url: string): Promise<{ ok: boolean; status: number; body: any; headers: Headers }> {
  const k = key();
  if (!k) return { ok: false, status: 0, body: null, headers: new Headers() };
  const res = await fetch(`${url}&apiKey=${k}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0 Safari/537.36' },
    signal: AbortSignal.timeout(15000),
  });
  const rem = res.headers.get('x-requests-remaining');
  if (rem) remaining = parseInt(rem, 10);
  if (res.status === 429) {
    const body = await res.json().catch(() => null);
    if (body?.error_code === 'REQUEST_LIMIT_REACHED') remaining = 0;
  }
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, body, headers: res.headers };
}

export interface OddsResult {
  available: boolean;
  reason?: string;
  source: string;
  sport?: string;
  event?: { id: string; home: string; away: string; commenceTime: string };
  markets?: Record<string, any>;
  props?: { available: boolean; reason?: string };
  remaining?: number | null;
}

function americanImplied(price: number): number {
  if (price > 0) return Math.round((100 / (price + 100)) * 1000) / 10;
  return Math.round((Math.abs(price) / (Math.abs(price) + 100)) * 1000) / 10;
}

function pickBookmaker(event: any, markets: string[]): any {
  const bms: any[] = event?.bookmakers ?? [];
  for (const bm of bms) {
    const present = (bm.markets ?? []).map((m: any) => m.key);
    if (markets.every((m) => present.includes(m))) return bm;
  }
  return bms[0] ?? null;
}

/** Featured odds (list of events) for a sport. */
export async function getFeaturedOdds(sport: string): Promise<OddsResult> {
  const k = key();
  if (!k) return { available: false, reason: 'ODDS_API_KEY not configured', source: SOURCE };
  const sportKey: string | undefined = SPORT_KEYS[sport?.toLowerCase() ?? ''] ?? sport;
  if (!sportKey) return { available: false, reason: `unknown sport "${sport}"`, source: SOURCE };
  if (remaining !== null && remaining < 50) {
    return { available: false, reason: 'quota low (x-requests-remaining < 50), skipping Odds API pulls', source: SOURCE, remaining };
  }
  try {
    const { ok, status, body } = await getJson(
      `${BASE}/sports/${sportKey}/odds/?regions=us&markets=h2h,spreads,totals&oddsFormat=american`
    );
    if (!ok) {
      return { available: false, reason: `Odds API HTTP ${status}: ${body?.message ?? 'error'}`, source: SOURCE, remaining };
    }
    if (!Array.isArray(body) || body.length === 0) {
      return { available: false, reason: `no events currently offered for ${sportKey} (off-season is legitimately empty)`, source: SOURCE, remaining };
    }
    const events = body.map((ev: any) => ({
      id: ev.id,
      home: ev.home_team,
      away: ev.away_team,
      commenceTime: ev.commence_time,
      bookmaker: pickBookmaker(ev, ['h2h', 'spreads', 'totals']) ? pickBookmaker(ev, ['h2h', 'spreads', 'totals']).title : null,
    }));
    return { available: true, source: SOURCE, sport: sportKey, remaining, event: events[0] ?? undefined, markets: { events } as any };
  } catch (e) {
    return { available: false, reason: `Odds API fetch failed: ${(e as Error).message}`, source: SOURCE, remaining };
  }
}

/** Odds for a specific matchup — matches events by normalized team names and
 *  |julianday(commence_time) - now| < 0.5. */
export async function getGameOdds(
  teamA?: string,
  teamB?: string,
  sport?: string,
  markets: string[] = ['h2h', 'spreads', 'totals']
): Promise<OddsResult> {
  const k = key();
  if (!k) return { available: false, reason: 'ODDS_API_KEY not configured', source: SOURCE };
  const sportKey: string | undefined = SPORT_KEYS[sport?.toLowerCase() ?? ''] ?? sport;
  if (!sportKey) return { available: false, reason: `unknown sport "${sport}"`, source: SOURCE };
  if (remaining !== null && remaining < 50) {
    return { available: false, reason: 'quota low (x-requests-remaining < 50), skipping Odds API pulls', source: SOURCE, remaining };
  }
  try {
    const { ok, status, body } = await getJson(
      `${BASE}/sports/${sportKey}/odds/?regions=us&markets=h2h,spreads,totals&oddsFormat=american`
    );
    if (!ok) {
      return { available: false, reason: `Odds API HTTP ${status}: ${body?.message ?? 'error'}`, source: SOURCE, remaining };
    }
    if (!Array.isArray(body) || body.length === 0) {
      return { available: false, reason: `no ${sportKey} events offered right now`, source: SOURCE, remaining };
    }
    const now = Date.now() / 86400000;
    const na = teamA ? normalizeName(teamA) : null;
    const nb = teamB ? normalizeName(teamB) : null;
    let match = body.find((ev: any) => {
      const dt = Math.abs(new Date(ev.commence_time).getTime() / 86400000 - now);
      if (dt >= 0.5) return false;
      const h = normalizeName(ev.home_team);
      const a = normalizeName(ev.away_team);
      if (na && nb) {
        return (h === na && a === nb) || (h === nb && a === na);
      }
      return na ? h === na || a === na : true;
    });
    if (!match) {
      return {
        available: false,
        reason: `no Odds API event matching ${teamA ?? '?'} vs ${teamB ?? '?'} within 0.5 day (events: ${body.length})`,
        source: SOURCE,
        remaining,
      };
    }

    const bm = pickBookmaker(match, markets);
    const out: OddsResult = {
      available: true,
      source: SOURCE,
      sport: sportKey,
      event: {
        id: match.id,
        home: match.home_team,
        away: match.away_team,
        commenceTime: match.commence_time,
      },
      remaining,
      markets: {},
    };
    const mktMap: Record<string, any> = {};
    if (bm) {
      for (const m of bm.markets ?? []) {
        if (!markets.includes(m.key)) continue;
        mktMap[m.key] = (m.outcomes ?? []).map((o: any) => {
          const rec: Record<string, any> = {
            name: o.name,
            price: o.price,
            point: o.point ?? null,
            impliedProbPct: o.price != null ? americanImplied(o.price) : null,
          };
          if (o.name === match.home_team) rec.teamSide = 'home';
          if (o.name === match.away_team) rec.teamSide = 'away';
          return rec;
        });
      }
    }
    out.markets = mktMap;
    out.reason = bm ? `bookmaker: ${bm.title}` : 'no bookmaker with all requested markets';

    // Props are a SEPARATE call and need a Business plan — attempt, catch INVALID_MARKET
    const props = await getEventProps(sportKey, match.id);
    out.props = props;
    return out;
  } catch (e) {
    return { available: false, reason: `Odds API failed: ${(e as Error).message}`, source: SOURCE, remaining };
  }
}

/** Player props for one event (separate call; Business plan required). */
export async function getEventProps(
  sportKey: string,
  eventId: string
): Promise<{ available: boolean; reason?: string; markets?: any[] }> {
  const k = key();
  if (!k) return { available: false, reason: 'ODDS_API_KEY not configured' };
  try {
    const { ok, status, body } = await getJson(
      `${BASE}/sports/${sportKey}/events/${eventId}/odds/?markets=batter_hits,batter_total_bases,batter_rbis,batter_runs_scored,batter_home_runs,pitcher_strikeouts&oddsFormat=american`
    );
    if (!ok) {
      if (status === 400 || status === 422 || status === 404) {
        const code = body?.error_code ?? body?.message ?? `HTTP ${status}`;
        return { available: false, reason: `props require Business plan (${code})` };
      }
      return { available: false, reason: `props HTTP ${status}` };
    }
    if (Array.isArray(body) && body.length === 0) return { available: false, reason: 'no prop markets for this event' };
    const bm = body?.bookmakers?.[0];
    const markets = (bm?.markets ?? []).map((m: any) => ({
      key: m.key,
      outcomes: (m.outcomes ?? []).map((o: any) => ({ name: o.name, point: o.point ?? null, price: o.price, impliedProbPct: o.price != null ? americanImplied(o.price) : null })),
    }));
    return { available: true, reason: `bookmaker: ${bm?.title ?? 'n/a'}`, markets };
  } catch (e) {
    return { available: false, reason: `props fetch failed: ${(e as Error).message}` };
  }
}
