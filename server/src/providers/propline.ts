// ============================================================================
// PropLine (prop-line.com) — real player-prop lines and prices.
//
// Auth: X-API-Key header (PROPLINE_API_KEY). Base https://api.prop-line.com/v1.
// One bulk read per sport returns every upcoming event's props, so the screener
// can price candidates against an actual sportsbook line instead of proposing a
// model-derived one. Zero fabrication: a missing key, a malformed row, an
// unsupported market or a failed request all degrade to `available:false` and
// the caller keeps its no-odds research path.
// ============================================================================

import { canonicalPropMarket, isPlausiblePropLine } from '../models/propLineIntegrity.js';

const BASE = 'https://api.prop-line.com/v1';
const SOURCE = 'api.prop-line.com';
const CACHE_TTL_MS = 2 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 9000;

// Restricting books keeps the bulk payload to a few MB instead of tens.
const BOOKMAKERS = 'draftkings,fanduel';

const SPORT_KEYS: Record<string, string> = {
  mlb: 'baseball_mlb', nba: 'basketball_nba', nfl: 'football_nfl', nhl: 'hockey_nhl',
};

/** PropLine market key -> SportsEdge canonical market. */
export const PROPLINE_MARKETS: Record<string, Record<string, string>> = {
  mlb: {
    batter_hits: 'hits', batter_total_bases: 'totalBases', batter_home_runs: 'homeRuns',
    batter_rbis: 'rbi', batter_runs: 'runs', pitcher_strikeouts: 'strikeouts',
    pitcher_outs: 'outsRecorded',
  },
  nba: {
    player_points: 'points', player_rebounds: 'rebounds', player_assists: 'assists',
    player_threes: 'threePointersMade', player_points_rebounds_assists: 'pointsReboundsAssists',
  },
  nfl: {
    player_pass_yds: 'passingYards', player_pass_tds: 'passingTouchdowns',
    player_rush_yds: 'rushingYards', player_reception_yds: 'receivingYards',
    player_receptions: 'receptions', player_anytime_td: 'touchdowns',
  },
  nhl: {
    player_goals: 'goals', player_assists: 'assists', player_points: 'hockeyPoints',
    player_shots_on_goal: 'shotsOnGoal', player_saves: 'saves',
  },
};

export interface ProplinePrice {
  player: string;
  market: string;
  line: number;
  over: number | null;
  under: number | null;
  book: string;
  books: string[];
  bookCount: number;
  lineType: 'primary' | 'alternate';
  isAlternate: boolean;
  consensusRank: number;
  source: string;
  checkedAt?: string;
  lineLabel?: string;
}

export interface ProplinePriceResult {
  available: boolean;
  reason?: string;
  byKey: Map<string, ProplinePrice>;
  alternatesByKey: Map<string, ProplinePrice[]>;
}

export function proplineConfigured(): boolean {
  return Boolean(process.env.PROPLINE_API_KEY);
}

export function proplineMarketsFor(sport: string): string[] {
  return Object.keys(PROPLINE_MARKETS[String(sport).toLowerCase()] ?? {});
}

function price(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n !== 0 ? n : null;
}

/**
 * Group a bulk `/odds` payload into one primary quote per player+market.
 * Pure (no I/O) so the parsing contract is unit-testable without a key.
 *
 * Primary line = the line the most books quote; ties prefer a two-sided quote,
 * then the median line, so an alternate ladder row never displaces the market's
 * actual number.
 */
export function parseProplineOdds(payload: unknown, sport: string): ProplinePriceResult {
  const empty = (): ProplinePriceResult => ({ available: false, byKey: new Map(), alternatesByKey: new Map() });
  if (!Array.isArray(payload) || payload.length === 0) {
    return { ...empty(), reason: 'PropLine returned no events' };
  }
  const marketMap = PROPLINE_MARKETS[String(sport).toLowerCase()] ?? {};
  // player|market|line -> quote
  const quotes = new Map<string, ProplinePrice>();
  const booksSeen = new Map<string, Set<string>>();
  let newest: string | undefined;

  for (const event of payload) {
    const eventUpdate = typeof event?.last_update === 'string' ? event.last_update : undefined;
    if (eventUpdate && (!newest || Date.parse(eventUpdate) > Date.parse(newest))) newest = eventUpdate;
    for (const bookmaker of Array.isArray(event?.bookmakers) ? event.bookmakers : []) {
      const book = String(bookmaker?.key ?? bookmaker?.title ?? 'unknown');
      const bookUpdate = typeof bookmaker?.last_update === 'string' ? bookmaker.last_update : eventUpdate;
      for (const marketRow of Array.isArray(bookmaker?.markets) ? bookmaker.markets : []) {
        const canonical = marketMap[String(marketRow?.key ?? '')];
        if (!canonical) continue;
        const outcomes = Array.isArray(marketRow?.outcomes) ? marketRow.outcomes : [];
        for (const outcome of outcomes) {
          const player = String(outcome?.description ?? '').trim();
          const side = String(outcome?.name ?? '').toLowerCase();
          const line = Number(outcome?.point);
          const american = price(outcome?.price);
          if (!player || (side !== 'over' && side !== 'under') || american == null) continue;
          if (!Number.isFinite(line) || !isPlausiblePropLine(sport, canonical, line)) continue;
          const key = `${player.toLowerCase()}|${canonical.toLowerCase()}|${line}`;
          const quote = quotes.get(key) ?? {
            player, market: canonical, line, over: null, under: null,
            book, books: [], bookCount: 0, lineType: 'primary', isAlternate: false,
            consensusRank: 1, source: SOURCE, checkedAt: bookUpdate,
            lineLabel: 'PRIMARY LINE',
          };
          if (side === 'over') quote.over = quote.over == null ? american : Math.max(quote.over, american);
          if (side === 'under') quote.under = quote.under == null ? american : Math.max(quote.under, american);
          quote.books = [...new Set([...(quote.books ?? []), book])];
          quote.bookCount = quote.books.length;
          if (bookUpdate && (!quote.checkedAt || Date.parse(bookUpdate) < Date.parse(quote.checkedAt))) quote.checkedAt = bookUpdate;
          quotes.set(key, quote);
          const bookKey = `${player.toLowerCase()}|${canonical.toLowerCase()}`;
          const set = booksSeen.get(bookKey) ?? new Set<string>();
          set.add(book);
          booksSeen.set(bookKey, set);
        }
      }
    }
  }

  if (!quotes.size) return { ...empty(), reason: 'PropLine has no supported player props for this slate' };

  const grouped = new Map<string, ProplinePrice[]>();
  for (const quote of quotes.values()) {
    const key = `${quote.player.toLowerCase()}|${quote.market.toLowerCase()}`;
    grouped.set(key, [...(grouped.get(key) ?? []), quote]);
  }

  const byKey = new Map<string, ProplinePrice>();
  const alternatesByKey = new Map<string, ProplinePrice[]>();
  for (const [key, offers] of grouped) {
    const lines = [...new Set(offers.map((row) => row.line))].sort((a, b) => a - b);
    const medianLine = lines.length ? lines[Math.floor((lines.length - 1) / 2)] : null;
    const sorted = [...offers].sort((a, b) =>
      (b.bookCount ?? 0) - (a.bookCount ?? 0)
      || Number(b.over != null && b.under != null) - Number(a.over != null && a.under != null)
      || (medianLine == null ? 0 : Math.abs(a.line - medianLine) - Math.abs(b.line - medianLine)),
    );
    const primary = sorted[0];
    if (!primary) continue;
    byKey.set(key, {
      ...primary, lineType: 'primary', isAlternate: false, consensusRank: 1,
      checkedAt: primary.checkedAt ?? newest, lineLabel: 'PRIMARY LINE',
    });
    if (sorted.length > 1) {
      alternatesByKey.set(key, sorted.slice(1).map((row, index) => ({
        ...row, lineType: 'alternate', isAlternate: true, consensusRank: index + 2, lineLabel: 'ALTERNATE LINE',
      })));
    }
  }
  return { available: byKey.size > 0, byKey, alternatesByKey };
}

const cache = new Map<string, { at: number; value: ProplinePriceResult }>();

/** Real player-prop prices for every upcoming event of one sport. */
export async function getProplineSlatePrices(sport: string): Promise<ProplinePriceResult> {
  const key = String(sport).toLowerCase();
  const sportKey = SPORT_KEYS[key];
  const empty: ProplinePriceResult = { available: false, byKey: new Map(), alternatesByKey: new Map() };
  if (!process.env.PROPLINE_API_KEY) return { ...empty, reason: 'PROPLINE_API_KEY not configured' };
  if (!sportKey) return { ...empty, reason: `unsupported sport ${sport}` };
  const markets = proplineMarketsFor(key);
  if (!markets.length) return { ...empty, reason: `no PropLine market map for ${sport}` };

  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.value;

  try {
    const url = `${BASE}/sports/${encodeURIComponent(sportKey)}/odds`
      + `?markets=${markets.map(encodeURIComponent).join(',')}`
      + `&bookmakers=${encodeURIComponent(BOOKMAKERS)}&max_age=900`;
    const response = await fetch(url, {
      headers: { 'X-API-Key': process.env.PROPLINE_API_KEY as string, Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      const reason = `PropLine HTTP ${response.status}`;
      return { ...empty, reason };
    }
    const parsed = parseProplineOdds(await response.json(), key);
    if (parsed.available) cache.set(key, { at: Date.now(), value: parsed });
    return parsed;
  } catch (error) {
    return { ...empty, reason: `PropLine request failed: ${(error as Error).message}` };
  }
}

/** Test seam: clear the in-process cache. */
export function clearProplineCache(): void {
  cache.clear();
}
