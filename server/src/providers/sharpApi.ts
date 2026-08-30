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

const BASE = 'https://api.sharpapi.io/api/v1';
const SOURCE = 'api.sharpapi.io';

const SPORT_MAP: Record<string, { sport: string; league: string }> = {
  mlb: { sport: 'baseball', league: 'mlb' },
  nba: { sport: 'basketball', league: 'nba' },
  nfl: { sport: 'football', league: 'nfl' },
  nhl: { sport: 'hockey', league: 'nhl' },
};

const MARKET_TO_LABEL: Record<string, string> = {
  player_home_runs: 'Home Runs', player_hits: 'Hits', player_total_bases: 'Total Bases',
  player_strikeouts: 'Strikeouts', player_points: 'Points', player_rebounds: 'Rebounds',
  player_assists: 'Assists', player_threes: '3-Pointers', player_pass_yards: 'Passing Yards',
  player_rush_yards: 'Rushing Yards', player_reception_yards: 'Receiving Yards',
  player_goals: 'Goals', player_shots_on_goal: 'Shots on Goal', player_saves: 'Saves',
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
function groupProps(rows: any[]): any[] {
  const byKey = new Map<string, any>();
  for (const row of rows) {
    if (row?.is_player_prop !== true) continue;
    if (!row.player_name || row.line == null) continue;
    const side = String(row.selection_type || row.selection || '').toLowerCase();
    const isOver = side === 'over';
    const market = String(row.market_type || '');
    const line = Number(row.line);
    const odds = parseAmericanPrice(row.odds_american);
    if (odds == null) continue;
    const key = `${row.player_name}|${market}|${line}`;
    const cur = byKey.get(key) ?? {
      market: MARKET_TO_LABEL[market] ?? market,
      player: row.player_name,
      line,
      over: null as number | null,
      under: null as number | null,
      book: row.sportsbook || 'sharpapi',
    };
    if (isOver) cur.over = odds;
    else cur.under = odds;
    byKey.set(key, cur);
  }
  return Array.from(byKey.values()).map((m) => ({
    ...m,
    over: m.over ?? null,
    under: m.under ?? null,
  }));
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

  try {
    const rows: any[] = [];
    for (const market of markets) {
      const url = `${BASE}/odds?sport=${map.sport}&league=${map.league}&market_type=${market}&limit=500`;
      const resp = await fetch(url, { headers: { 'X-API-Key': k, 'User-Agent': 'SportsEdge/0.3' } });
      if (resp.ok) {
        const data = (await resp.json()) as { data?: any[] };
        rows.push(...(data.data || []).map((r) => ({ ...r, _market: market })));
      }
      // Free tier 12 req/min — pace.
      await new Promise((r) => setTimeout(r, 5500));
    }

    const props = groupProps(rows);
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
    const matched = groupProps(eventRows.length ? eventRows : rows);
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
