// SportsGameOdds API v2 — multi-book odds + scores + results in one event object.
// Auth via x-api-key header. Never put the credential in the URL because URLs
// are routinely retained by proxies, observability tools, and access logs.
// Key comes from SPORTSGAMEODDS_API_KEY in server/.env. Optional: returns
// {available:false} unless the key is set. Zero fabrication — never invent markets.
//
// Notable vs The Odds API (oddsApi.ts):
//  - Single /v2/events call returns ALL markets (h2h, spreads, totals, props)
//    per event, each with consensus bookOdds + per-bookmaker odds under byBookmaker.
//  - oddID = statID-statEntityID-periodID-betTypeID-sideID (e.g. points-home-game-sp-home).
//  - Pagination via nextCursor; we follow up to 5 pages to find a matchup.
//  - Free/limited keys may omit some bookmaker odds (API returns a "notice").

import { normalizeName } from './http.js';

const BASE = 'https://api.sportsgameodds.com/v2';
const SOURCE = 'api.sportsgameodds.com';

// SportsGameOdds leagueIDs (subset we use; full list is 67 leagues).
const LEAGUE_IDS: Record<string, string> = {
  mlb: 'MLB',
  baseball: 'MLB',
  nfl: 'NFL',
  football: 'NFL',
  nba: 'NBA',
  basketball: 'NBA',
  nhl: 'NHL',
  hockey: 'NHL',
  ufc: 'UFC',
  mma: 'UFC',
};

let lastNotice: string | null = null;

export function sgoConfigured(): boolean {
  return keys().length > 0;
}

export function sgoNotice(): string | null {
  return lastNotice;
}

function keys(): string[] {
  return [
    process.env.SPORTSGAMEODDS_API_KEY,
    process.env.SPORTSGAMEODDS_API_KEY_2,
  ].filter((value): value is string => Boolean(value?.trim()));
}

function key(): string | null {
  return keys()[0] ?? null;
}

function americanImplied(price: number): number {
  if (price > 0) return Math.round((100 / (price + 100)) * 1000) / 10;
  return Math.round((Math.abs(price) / (Math.abs(price) + 100)) * 1000) / 10;
}

function parseAmerican(v: any): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : parseInt(String(v).replace(/[^\d+-]/g, ''), 10);
  return Number.isNaN(n) ? null : n;
}

interface SgoEvent {
  eventID: string;
  leagueID: string;
  status: { started: boolean; completed: boolean; live: boolean; startsAt?: string };
  teams: { home: { names: { long: string; short: string } }; away: { names: { long: string; short: string } } };
  odds?: Record<string, any>;
}

async function fetchEvents(leagueID: string, oddsOnly = true, cursor?: string): Promise<{ events: SgoEvent[]; next: string | null; notice: string | null; rateLimited: boolean }> {
  const credentials = keys();
  if (!credentials.length) return { events: [], next: null, notice: null, rateLimited: false };
  const params = new URLSearchParams({ leagueID });
  if (oddsOnly) params.set('oddsAvailable', 'true');
  if (cursor) params.set('cursor', cursor);
  const url = `${BASE}/events?${params.toString()}`;

  let lastStatus = 0;
  let lastBody: any = null;
  let networkFailure: string | null = null;
  for (const credential of credentials) {
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { 'x-api-key': credential, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0 Safari/537.36' },
        signal: AbortSignal.timeout(5000),
      });
    } catch (e) {
      // DNS/socket/timeout failures must fail over to the next key like 401/403/429
      // do — an unhandled throw here crashed the whole getEvents walk and took
      // every downstream tool result with it.
      const err = e as Error;
      networkFailure = `${err.name === 'TimeoutError' ? 'timeout' : err.message}`;
      console.warn(`[sportsGameOdds] key #${credentials.indexOf(credential) + 1} network failure: ${networkFailure}`);
      continue;
    }
    const body = await res.json().catch(() => null);
    lastStatus = res.status;
    lastBody = body;
    // Fail over only for credential/quota failures. Do not hide provider errors.
    if ((res.status === 401 || res.status === 403 || res.status === 429) && credential !== credentials[credentials.length - 1]) {
      continue;
    }
    if (res.status === 429) {
      lastNotice = 'Rate limit exceeded (free-tier quota)';
      return { events: [], next: null, notice: lastNotice, rateLimited: true };
    }
    if (!res.ok || !body) {
      lastNotice = body?.error ?? `HTTP ${res.status}`;
      return { events: [], next: null, notice: lastNotice, rateLimited: false };
    }
    lastNotice = body.notice ?? null;
    return {
      events: (body.data ?? []) as SgoEvent[],
      next: body.nextCursor ?? null,
      notice: lastNotice,
      rateLimited: false,
    };
  }
  lastNotice = lastBody?.error ?? (networkFailure ? `network failure: ${networkFailure}` : null) ?? `HTTP ${lastStatus}`;
  return { events: [], next: null, notice: lastNotice, rateLimited: lastStatus === 429 };
}

// Pull pages until we have a candidate match or run out (max 5 pages).
async function collectEvents(leagueID: string, firstPageOnly: boolean): Promise<{ events: SgoEvent[]; rateLimited: boolean }> {
  const all: SgoEvent[] = [];
  let cursor: string | undefined;
  let rateLimited = false;
  for (let i = 0; i < 5; i++) {
    const { events, next, rateLimited: rl } = await fetchEvents(leagueID, true, cursor);
    if (rl) { rateLimited = true; break; }
    all.push(...events);
    if (firstPageOnly) break;
    if (!next) break;
    cursor = next;
  }
  return { events: all, rateLimited };
}

function teamNames(ev: SgoEvent): { home: string; away: string } {
  return {
    home: ev.teams?.home?.names?.long ?? 'Home',
    away: ev.teams?.away?.names?.long ?? 'Away',
  };
}

// Map an SGO event's odds object into the {h2h, spreads, totals} shape the tool uses.
function mapMarkets(odds: Record<string, any> | undefined): Record<string, any> {
  const out: Record<string, any> = { h2h: [], spreads: [], totals: [] };
  if (!odds) return out;
  for (const [oddID, o] of Object.entries(odds)) {
    if (!o) continue;
    const parts = oddID.split('-');
    const betType = parts[3]; // ml | sp | ou
    const side = parts[4]; // home | away | over | under
    const bookOdds = parseAmerican(o.bookOdds ?? o.fairOdds);
    const overUnder = o.bookOverUnder ?? o.fairOverUnder;
    const rec: any = {
      oddID,
      bookOdds,
      fairOdds: parseAmerican(o.fairOdds),
      overUnder: overUnder != null ? Number(overUnder) : null,
      impliedProbPct: bookOdds != null ? americanImplied(bookOdds) : null,
      byBookmaker: o.byBookmaker ?? {},
      naTeams: o.naTeams ?? undefined,
    };
    if (betType === 'ml') {
      rec.name = side === 'home' ? 'Home' : 'Away';
      rec.teamSide = side;
      out.h2h.push(rec);
    } else if (betType === 'sp') {
      rec.name = side === 'home' ? 'Home' : 'Away';
      rec.teamSide = side;
      out.spreads.push(rec);
    } else if (betType === 'ou') {
      rec.name = side === 'over' ? 'Over' : 'Under';
      out.totals.push(rec);
    }
  }
  // strip empties
  if (out.h2h.length === 0) delete out.h2h;
  if (out.spreads.length === 0) delete out.spreads;
  if (out.totals.length === 0) delete out.totals;
  return out;
}

function matchEvent(events: SgoEvent[], na?: string | null, nb?: string | null): SgoEvent | undefined {
  if (!events.length) return undefined;
  if (!na && !nb) return events.find((e) => !e.status?.completed) ?? events[0];
  const matches = events.filter((e) => {
    const { home, away } = teamNames(e);
    const h = normalizeName(home);
    const a = normalizeName(away);
    if (na && nb) return (h === na && a === nb) || (h === nb && a === na);
    return na ? h === na || a === na : true;
  });
  return matches.find((e) => !e.status?.completed) ?? matches[0];
}

export interface SgoResult {
  available: boolean;
  reason?: string;
  source: string;
  sport?: string;
  event?: { id: string; home: string; away: string; commenceTime: string };
  markets?: Record<string, any>;
  props?: { available: boolean; reason?: string; markets?: any[] };
  notice?: string | null;
}

/** Featured odds for a sport (first available event). */
export async function getSgoFeaturedOdds(sport: string): Promise<SgoResult> {
  const k = key();
  if (!k) return { available: false, reason: 'SPORTSGAMEODDS_API_KEY not configured', source: SOURCE };
  const league = LEAGUE_IDS[sport?.toLowerCase() ?? ''];
  if (!league) return { available: false, reason: `unknown sport "${sport}"`, source: SOURCE };
  try {
    const { events, rateLimited } = await collectEvents(league, true);
    if (!events.length) return { available: false, reason: rateLimited ? 'rate limited (free-tier quota)' : `no ${league} events with odds right now`, source: SOURCE, notice: lastNotice };
    const ev = events[0];
    const { home, away } = teamNames(ev);
    return {
      available: true,
      source: SOURCE,
      sport: league,
      event: { id: ev.eventID, home, away, commenceTime: ev.status?.startsAt ?? '' },
      markets: mapMarkets(ev.odds),
      notice: lastNotice,
    };
  } catch (e) {
    return { available: false, reason: `SportsGameOdds fetch failed: ${(e as Error).message}`, source: SOURCE };
  }
}

export interface SgoSlateProp {
  playerId: string;
  playerName: string;
  market: string;
  side: 'over' | 'under';
  line: number | null;
  odds: number | null;
  fairOdds: number | null;
  oddID: string;
  byBookmaker: Record<string, any>;
}

export interface SgoSlateEvent {
  id: string;
  league: string;
  home: string;
  away: string;
  commenceTime: string;
  completed: boolean;
  props: SgoSlateProp[];
}

function displayPlayerName(playerId: string): string {
  return playerId
    .replace(/_\d+_(?:MLB|NBA|NFL|NHL)$/i, '')
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function bookmakerConsensus(raw: any): { odds: number | null; line: number | null } {
  const books = raw?.byBookmaker && typeof raw.byBookmaker === 'object'
    ? Object.values(raw.byBookmaker) as any[]
    : [];
  for (const book of books) {
    if (!book || typeof book !== 'object') continue;
    const odds = parseAmerican(book.odds ?? book.bookOdds ?? book.price);
    const lineValue = book.overUnder ?? book.bookOverUnder ?? book.line;
    const line = lineValue == null || !Number.isFinite(Number(lineValue)) ? null : Number(lineValue);
    if (odds != null || line != null) return { odds, line };
  }
  return { odds: null, line: null };
}

function extractSlateProps(odds: Record<string, any> | undefined): SgoSlateProp[] {
  if (!odds) return [];
  const out: SgoSlateProp[] = [];
  for (const [oddID, raw] of Object.entries(odds)) {
    if (!raw) continue;
    const parts = oddID.split('-');
    const stat = parts[0] ?? '';
    const playerId = String(raw.playerID ?? raw.statEntityID ?? parts[1] ?? '');
    const side = String(raw.sideID ?? parts[4] ?? '').toLowerCase();
    const bookmaker = bookmakerConsensus(raw);
    const lineValue = raw.bookOverUnder ?? raw.fairOverUnder ?? bookmaker.line;
    const oddsValue = raw.bookOdds ?? bookmaker.odds;
    if (!playerId || ['home', 'away', 'all'].includes(playerId.toLowerCase())) continue;
    if (side !== 'over' && side !== 'under') continue;
    out.push({
      playerId,
      playerName: String(raw.playerName ?? displayPlayerName(playerId)),
      market: stat,
      side,
      line: lineValue == null || !Number.isFinite(Number(lineValue)) ? null : Number(lineValue),
      odds: parseAmerican(oddsValue),
      fairOdds: parseAmerican(raw.fairOdds),
      oddID,
      byBookmaker: raw.byBookmaker ?? {},
    });
  }
  return out;
}

/** Bulk live slate feed: one bounded provider request window per sport. */
export async function getSgoSlateEvents(sport: string, maxEvents = 10): Promise<{ available: boolean; reason?: string; source: string; events: SgoSlateEvent[]; notice?: string | null }> {
  const k = key();
  const league = LEAGUE_IDS[sport?.toLowerCase() ?? ''];
  if (!k) return { available: false, reason: 'SPORTSGAMEODDS_API_KEY not configured', source: SOURCE, events: [] };
  if (!league) return { available: false, reason: `unknown sport "${sport}"`, source: SOURCE, events: [] };
  try {
    const { events, rateLimited } = await collectEvents(league, true);
    const rows = events
      .filter((event) => !event.status?.completed)
      .slice(0, Math.max(1, Math.min(12, maxEvents)))
      .map((event) => {
        const names = teamNames(event);
        return {
          id: event.eventID,
          league,
          home: names.home,
          away: names.away,
          commenceTime: event.status?.startsAt ?? '',
          completed: Boolean(event.status?.completed),
          props: extractSlateProps(event.odds),
        };
      });
    return rows.length
      ? { available: true, source: SOURCE, events: rows, notice: lastNotice }
      : { available: false, reason: rateLimited ? 'rate limited (free-tier quota)' : `no upcoming ${league} events with props`, source: SOURCE, events: [], notice: lastNotice };
  } catch (error) {
    return { available: false, reason: `SportsGameOdds slate fetch failed: ${(error as Error).message}`, source: SOURCE, events: [] };
  }
}

/** Odds for a specific matchup. */
export async function getSgoGameOdds(
  teamA?: string,
  teamB?: string,
  sport?: string
): Promise<SgoResult> {
  const k = key();
  if (!k) return { available: false, reason: 'SPORTSGAMEODDS_API_KEY not configured', source: SOURCE };
  const league = LEAGUE_IDS[sport?.toLowerCase() ?? ''];
  if (!league) return { available: false, reason: `unknown sport "${sport}"`, source: SOURCE };

  // Pre-warmed cache (odds-cache cron): a full slate walk is expensive, so the
  // cron stores per-event payloads in Redis with a short TTL. Reads are free.
  const cached = await readOddsCache(league, teamA, teamB);
  if (cached) return { ...cached, source: SOURCE, notice: lastNotice ?? 'served from pre-warm odds cache' };

  try {
    const na = teamA ? normalizeName(teamA) : null;
    const nb = teamB ? normalizeName(teamB) : null;
    // A requested matchup may be on a later provider page. Walk the bounded
    // cursor window instead of stopping as soon as page one is non-empty.
    const { events, rateLimited } = await collectEvents(league, false);
    const ev = matchEvent(events, na, nb);
    if (!ev) {
      return { available: false, reason: rateLimited ? 'rate limited (free-tier quota)' : `no SportsGameOdds event matching ${teamA ?? '?'} vs ${teamB ?? '?'}`, source: SOURCE, notice: lastNotice };
    }
    const result = buildSgoResult(ev, league);
    await writeOddsCache(league, ev, result).catch(() => {});
    return { ...result, notice: lastNotice };
  } catch (e) {
    return { available: false, reason: `SportsGameOdds fetch failed: ${(e as Error).message}`, source: SOURCE };
  }
}

function buildSgoResult(ev: SgoEvent, league: string): SgoResult {
  const { home, away } = teamNames(ev);
  return {
    available: true,
    source: SOURCE,
    sport: league,
    event: { id: ev.eventID, home, away, commenceTime: ev.status?.startsAt ?? '' },
    markets: mapMarkets(ev.odds),
    props: extractProps(ev.odds),
  };
}

const ODDS_CACHE_PREFIX = 'sportsedge:odds-cache';
const ODDS_CACHE_TTL_SECONDS = 30 * 60;

function oddsCacheIndexKey(league: string): string {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return `${ODDS_CACHE_PREFIX}:${league}:${day}`;
}

async function readOddsCache(league: string, teamA?: string, teamB?: string): Promise<SgoResult | null> {
  try {
    const { redisCommand, redisConfigured } = await import('../lib/predictionStore.js');
    if (!redisConfigured()) return null;
    const raw = await redisCommand<string>(['GET', `${oddsCacheIndexKey(league)}:payloads`]);
    if (!raw) return null;
    const payloads = JSON.parse(raw) as SgoResult[];
    if (!payloads.length) return null;
    if (!teamA && !teamB) {
      // No matchup filter: serve the freshest cached event so callers scanning
      // a slate still get verified prices without paying for a live walk.
      return payloads[0] ?? null;
    }
    const na = teamA ? normalizeName(teamA) : '';
    const nb = teamB ? normalizeName(teamB) : '';
    const hit = payloads.find((p) => {
      const h = p.event?.home ? normalizeName(p.event.home) : '';
      const a = p.event?.away ? normalizeName(p.event.away) : '';
      return (h === na && a === nb) || (h === nb && a === na) || h === na || a === na;
    });
    return hit ?? null;
  } catch {
    return null; // cache is best-effort; never block live reads on cache errors
  }
}

async function writeOddsCache(league: string, ev: SgoEvent, result: SgoResult): Promise<void> {
  const { redisCommand, redisConfigured } = await import('../lib/predictionStore.js');
  if (!redisConfigured()) return;
  const key = `${oddsCacheIndexKey(league)}:payloads`;
  let payloads: SgoResult[] = [];
  try {
    const raw = await redisCommand<string | null>(['GET', key]);
    if (raw) payloads = JSON.parse(raw) as SgoResult[];
  } catch { /* start fresh */ }
  const { home, away } = teamNames(ev);
  payloads = payloads.filter((p) => !(p.event?.home === home && p.event?.away === away));
  payloads.unshift(result);
  payloads = payloads.slice(0, 24); // bound memory: ~a day's slate per league
  await redisCommand(['SET', key, JSON.stringify(payloads), 'EX', ODDS_CACHE_TTL_SECONDS]);
}

/** Pre-warm the odds cache for a whole slate. Called by /api/cron/odds-cache. */
export async function warmSgoOddsCache(sport: string): Promise<{ warmed: number; events: number; rateLimited?: boolean }> {
  const k = key();
  if (!k) return { warmed: 0, events: 0 };
  const league = LEAGUE_IDS[sport?.toLowerCase() ?? ''];
  if (!league) return { warmed: 0, events: 0 };
  try {
    const { events, rateLimited } = await collectEvents(league, false);
    if (!events.length) return { warmed: 0, events: 0, rateLimited };
    const usable = events.filter((ev) => !ev.status?.completed).slice(0, 16);
    let warmed = 0;
    for (const ev of usable) {
      try {
        const result = buildSgoResult(ev, league);
        await writeOddsCache(league, ev, result);
        warmed++;
      } catch { /* keep warming the rest */ }
    }
    return { warmed, events: events.length, rateLimited };
  } catch {
    return { warmed: 0, events: 0 };
  }
}

/** Player props = any oddID whose statEntityID is a player (not home/away/all). */
function extractProps(odds: Record<string, any> | undefined): { available: boolean; reason?: string; markets?: any[] } {
  if (!odds) return { available: false, reason: 'no odds object' };
  const markets: any[] = [];
  for (const [oddID, o] of Object.entries(odds)) {
    const parts = oddID.split('-');
    const entity = parts[1];
    if (entity !== 'home' && entity !== 'away' && entity !== 'all') {
      markets.push({
        oddID,
        name: parts[0],
        player: entity,
        side: parts[4],
        bookOdds: parseAmerican(o.bookOdds),
        overUnder: o.bookOverUnder != null ? Number(o.bookOverUnder) : null,
        byBookmaker: o.byBookmaker ?? {},
      });
    }
  }
  return markets.length
    ? { available: true, reason: `${markets.length} prop markets`, markets }
    : { available: false, reason: 'no player props in this event' };
}
