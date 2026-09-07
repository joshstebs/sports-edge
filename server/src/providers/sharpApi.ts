// ============================================================================
// SharpApi Provider — real player-prop odds (MLB/NBA/NFL/NHL).
// Auth: X-API-Key header (SHARPAPI_API_KEY). Free tier: 60s data delay,
// DraftKings + FanDuel books, 12 req/min.
//
// Returns the same shape as the other odds providers (OddsResult) so it slots
// into the game_odds fallback chain. Player props are grouped by market under
// `props.markets`. Zero fabrication — if the source has no live props (e.g. a
// season not yet started) it reports unavailable rather than inventing lines.
// ============================================================================

import { canonicalPropMarket, isPlausiblePropLine } from '../models/propLineIntegrity.js';

const BASE = 'https://api.sharpapi.io/api/v1';
const SOURCE = 'api.sharpapi.io';

const SPORT_MAP: Record<string, { sport: string; league: string }> = {
  mlb: { sport: 'baseball', league: 'mlb' },
  nba: { sport: 'basketball', league: 'nba' },
  nfl: { sport: 'football', league: 'nfl' },
  nhl: { sport: 'hockey', league: 'nhl' },
};

export interface SharpOddsResult {
  available: boolean;
  reason?: string;
  source: string;
  sport?: string;
  event?: { id: string; home: string; away: string; commenceTime: string };
  markets?: Record<string, any>;
  props?: { available: boolean; reason?: string; markets?: any[] };
  notice?: string | null;
}

function key(): string {
  return process.env.SHARPAPI_API_KEY || '';
}

export function sharpConfigured(): boolean {
  return Boolean(key());
}

function parseAmericanPrice(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n !== 0 ? n : null;
}

/** Group SharpApi player-prop rows into per-market arrays, one best line each. */
function groupProps(rows: any[], sport?: string): any[] {
  const byKey = new Map<string, any>();
  for (const row of rows) {
    if (row?.is_player_prop !== true || !row.player_name || row.line == null) continue;
    const side = String(row.selection_type || row.selection || '').toLowerCase();
    if (side !== 'over' && side !== 'under') continue;
    const rawMarket = String(row.market_type || row._market || '');
    const market = canonicalPropMarket(rawMarket, sport);
    const line = Number(row.line);
    if (!market || !isPlausiblePropLine(sport ?? '', market, line)) continue;
    const odds = parseAmericanPrice(row.odds_american);
    if (!Number.isFinite(line) || odds == null) continue;
    const book = String(row.sportsbook || 'sharpapi');
    const key = String(row.player_name).toLowerCase() + '|' + market + '|' + line;
    const cur = byKey.get(key) ?? {
      market, player: row.player_name, line,
      over: null, under: null, overBook: null, underBook: null, _books: new Set<string>(),
    };
    cur._books.add(book);
    if (side === 'over' && (cur.over == null || odds > cur.over)) { cur.over = odds; cur.overBook = book; }
    if (side === 'under' && (cur.under == null || odds > cur.under)) { cur.under = odds; cur.underBook = book; }
    byKey.set(key, cur);
  }

  const rowsByMarket = new Map<string, any[]>();
  for (const row of byKey.values()) {
    const books = [...row._books];
    const clean = { ...row, books, bookCount: books.length, book: row.overBook ?? row.underBook ?? books[0] ?? 'sharpapi' };
    delete clean._books;
    const key = String(clean.player).toLowerCase() + '|' + String(clean.market).toLowerCase();
    rowsByMarket.set(key, [...(rowsByMarket.get(key) ?? []), clean]);
  }

  const output: any[] = [];
  for (const offers of rowsByMarket.values()) {
    const sorted = [...offers].sort((a, b) =>
      (b.bookCount ?? 0) - (a.bookCount ?? 0)
      || Number(b.over != null && b.under != null) - Number(a.over != null && a.under != null)
      || Math.abs(Number(a.over ?? -110) + 110) - Math.abs(Number(b.over ?? -110) + 110)
    );
    sorted.forEach((offer, index) => output.push({
      ...offer, lineType: index === 0 ? 'primary' : 'alternate', isAlternate: index !== 0, consensusRank: index + 1,
    }));
  }
  return output;
}

/**
 * Player-prop odds for a specific matchup (teamA @ teamB). Matches on the
 * SharpApi event home/away names so we only emit props for THIS game.
 */
export async function getSharpGameOdds(
  teamA?: string,
  teamB?: string,
  sportInput?: string,
): Promise<SharpOddsResult> {
  const k = key();
  if (!k) return { available: false, reason: 'SHARPAPI_API_KEY not configured', source: SOURCE };
  const sportKey = (sportInput || '').toLowerCase();
  const map = SPORT_MAP[sportKey];
  if (!map) return { available: false, reason: `unknown sport "${sportInput}"`, source: SOURCE };

  const marketsForSport: Record<string, string[]> = {
    mlb: ['player_home_runs', 'player_hits', 'player_total_bases', 'player_strikeouts'],
    nba: ['player_points', 'player_rebounds', 'player_assists', 'player_threes'],
    nfl: ['player_pass_yards', 'player_reception_yards'],
    nhl: ['player_goals', 'player_shots_on_goal', 'player_saves'],
  };
  const markets = marketsForSport[sportKey] ?? [];

  const WALK_DEADLINE_MS = 18_000; // keep the whole 4-market walk inside the screener's budget
  const FETCH_TIMEOUT_MS = 6_000;
  const walkStartedAt = Date.now();
  const remainingBudgetMs = () => walkStartedAt + WALK_DEADLINE_MS - Date.now();

  try {
    const rows: any[] = [];
    let missingMarkets: string[] = [];
    for (const market of markets) {
      if (remainingBudgetMs() < 2_500) {
        console.warn(`[sharpApi] walk budget exhausted after ${rows.length} rows; skipping remaining ${markets.length - markets.indexOf(market) - 1} market(s)`);
        break;
      }
      const url = `${BASE}/odds?sport=${map.sport}&league=${map.league}&market_type=${market}&limit=500`;
      // Attempt each market at most twice: once immediately, once after a paced
      // wait when the free tier answers 429 (12 req/min). Never hang the parent
      // tool on a stalled fetch — every request carries its own timeout.
      for (let attempt = 0; attempt < 2; attempt++) {
        if (remainingBudgetMs() < 2_500) break;
        try {
          const resp = await fetch(url, {
            headers: { 'X-API-Key': k, 'User-Agent': 'SportsEdge/0.3' },
            signal: AbortSignal.timeout(Math.min(FETCH_TIMEOUT_MS, remainingBudgetMs())),
          });
          if (resp.status === 429 && attempt === 0) {
            const retryAfter = Number(resp.headers.get('retry-after')) || 0;
            await resp.body?.cancel().catch(() => {});
            await new Promise((r) => setTimeout(r, Math.min(7_000, Math.max(6_500, retryAfter * 1000))));
            continue;
          }
          if (!resp.ok) {
            // 400/401/403/404/5xx will not improve by hammering the other markets
            console.warn(`[sharpApi] market ${market} HTTP ${resp.status}; stopping walk`);
            missingMarkets.push(market);
            await resp.body?.cancel().catch(() => {});
            break;
          }
          const data = (await resp.json().catch(() => null)) as { data?: any[] } | null;
          const fetched = data?.data ?? [];
          rows.push(...fetched.map((r) => ({ ...r, _market: market })));
          break;
        } catch (fetchError) {
          const err = fetchError as Error;
          console.warn(`[sharpApi] market ${market} attempt ${attempt + 1} failed: ${err.name === 'TimeoutError' ? 'timeout' : err.message}`);
          if (attempt === 1) break;
        }
      }
    }
    if (!rows.length && missingMarkets.length === markets.length) {
      return { available: false, reason: `SharpApi unreachable for all ${markets.length} markets (HTTP errors/timeouts)`, source: SOURCE };
    }

    const props = groupProps(rows, sportKey);
    if (props.length === 0) {
      return { available: false, reason: `SharpApi returned no live player props for ${map.league.toUpperCase()} (season not started or no props posted)`, source: SOURCE };
    }

    // If a matchup was requested, prefer the first event matching both teams.
    const aNorm = String(teamA ?? '').toLowerCase().replace(/\s+/g, '');
    const bNorm = String(teamB ?? '').toLowerCase().replace(/\s+/g, '');
    const eventRows = aNorm && bNorm
      ? rows.filter((r) => {
          const home = String(r.home_team?.name ?? r.home_team ?? '').toLowerCase().replace(/\s+/g, '');
          const away = String(r.away_team?.name ?? r.away_team ?? '').toLowerCase().replace(/\s+/g, '');
          return (home === aNorm && away === bNorm) || (home === bNorm && away === aNorm);
        })
      : rows;
    const matched = groupProps(eventRows.length ? eventRows : rows, sportKey);
    const first = rows[0];

    return {
      available: true,
      source: SOURCE,
      sport: sportKey,
      event: first
        ? {
            id: String(first.event_id || first.event_uuid || ''),
            home: String(first.home_team?.name ?? first.home_team ?? ''),
            away: String(first.away_team?.name ?? first.away_team ?? ''),
            commenceTime: String(first.event_start_time ?? ''),
          }
        : undefined,
      markets: { playerProps: matched },
      props: { available: true, markets: matched },
      notice: 'SharpApi player props (free tier: 60s delay, DraftKings+FanDuel). Verify before betting.',
    };
  } catch (error) {
    return { available: false, reason: `SharpApi fetch failed: ${(error as Error).message}`, source: SOURCE };
  }
}

/** Featured player-prop odds for a sport (first available event). */
export async function getSharpFeaturedProps(sportInput: string): Promise<SharpOddsResult> {
  return getSharpGameOdds(undefined, undefined, sportInput);
}
