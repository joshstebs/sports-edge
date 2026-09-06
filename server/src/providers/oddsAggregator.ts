// Multi-Sportsbook Odds Provider
// Fetches live odds from The Odds API and other sources, normalizes markets, finds best lines

import { z } from 'zod';

export interface OddsMarket {
  market: string;        // e.g., 'player_hits', 'player_home_runs', 'player_total_bases'
  side: 'over' | 'under';
  line: number;          // e.g., 1.5
  odds: number;          // American odds e.g., -115
  book: string;          // e.g., 'pinnacle', 'draftkings', 'fanduel'
  lastUpdated: string;   // ISO timestamp
  playerName?: string;    // populated for player-prop markets
}

export interface PlayerOdds {
  playerName: string;
  sport: string;
  gameId: string;
  markets: OddsMarket[];
  bestLines: Record<string, { over: OddsMarket | null; under: OddsMarket | null }>;
}

export interface GameOdds {
  gameId: string;
  sport: string;
  homeTeam: string;
  awayTeam: string;
  startTime: string;
  moneyline: { home: number; away: number; draw?: number };
  spread: { line: number; homeOdds: number; awayOdds: number };
  total: { line: number; over: number; under: number };
  playerProps: PlayerOdds[];
  books: string[];
  lastUpdated: string;
}

export interface OddsProviderConfig {
  theOddsApiKey?: string;
  sports: string[];
  markets: string[];
  regions: string[];     // 'us', 'us2', 'uk', 'eu', 'au'
  bookmakers: string[];  // specific books to fetch
}

/** Normalize market names across books to canonical form */
export function normalizeMarketName(rawMarket: string, sport: string): string {
  const lower = rawMarket.toLowerCase();
  
  // MLB player props
  if (sport === 'mlb' || sport === 'baseball') {
    if (lower.includes('hit') && !lower.includes('allowed')) return 'player_hits';
    if (lower.includes('total base')) return 'player_total_bases';
    if (lower.includes('home run') || lower.includes('hr')) return 'player_home_runs';
    if (lower.includes('rbi') || lower.includes('runs batted')) return 'player_rbis';
    if (lower.includes('run') && !lower.includes('allowed')) return 'player_runs';
    if (lower.includes('walk') || lower.includes('base on balls')) return 'player_walks';
    if (lower.includes('strikeout') || lower.includes('k')) return 'player_strikeouts';
    if (lower.includes('earned run')) return 'player_earned_runs';
    if (lower.includes('hits allowed')) return 'player_hits_allowed';
    if (lower.includes('walks allowed')) return 'player_walks_allowed';
    if (lower.includes('outs')) return 'player_outs';
  }
  
  // NFL player props
  if (sport === 'nfl' || sport === 'football') {
    if (lower.includes('pass') && lower.includes('yard')) return 'player_pass_yards';
    if (lower.includes('rush') && lower.includes('yard')) return 'player_rush_yards';
    if (lower.includes('receiv') && lower.includes('yard')) return 'player_receiving_yards';
    if (lower.includes('pass') && lower.includes('td')) return 'player_pass_tds';
    if (lower.includes('rush') && lower.includes('td')) return 'player_rush_tds';
    if (lower.includes('receiv') && lower.includes('td')) return 'player_receiving_tds';
    if (lower.includes('reception')) return 'player_receptions';
    if (lower.includes('interception')) return 'player_interceptions';
    if (lower.includes('sack')) return 'player_sacks';
    if (lower.includes('tackle')) return 'player_tackles';
  }
  
  // NBA player props
  if (sport === 'nba' || sport === 'basketball') {
    if (lower.includes('point')) return 'player_points';
    if (lower.includes('rebound')) return 'player_rebounds';
    if (lower.includes('assist')) return 'player_assists';
    if (lower.includes('three') && (lower.includes('made') || lower.includes('3pt'))) return 'player_threes_made';
    if (lower.includes('steal')) return 'player_steals';
    if (lower.includes('block')) return 'player_blocks';
    if (lower.includes('turnover')) return 'player_turnovers';
    if (lower.includes('points') && lower.includes('rebounds') && lower.includes('assists')) return 'player_pts_rebs_asts';
    if (lower.includes('pts') && lower.includes('reb') && lower.includes('ast')) return 'player_pts_rebs_asts';
  }
  
  // NHL player props
  if (sport === 'nhl' || sport === 'hockey') {
    if (lower.includes('goal')) return 'player_goals';
    if (lower.includes('assist')) return 'player_assists';
    if (lower.includes('shot')) return 'player_shots';
    if (lower.includes('save')) return 'player_saves';
    if (lower.includes('goalie') || lower.includes('goals against')) return 'goalie_goals_against';
  }
  
  return rawMarket.toLowerCase().replace(/\s+/g, '_');
}

/** Convert American odds to implied probability */
export function americanToImplied(odds: number): number {
  if (odds > 0) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
}

/** Convert implied probability to American odds */
export function impliedToAmerican(implied: number): number {
  if (implied >= 0.5) return -Math.round((implied / (1 - implied)) * 100);
  return Math.round(((1 - implied) / implied) * 100);
}

/** Prefer the market's primary consensus line, then line-shop price.
 * Historical logic incorrectly preferred a HIGHER Over line and LOWER Under
 * line. Consensus frequency is now authoritative; alternates cannot displace it. */
export function findBestLine(markets: OddsMarket[], market: string, side: 'over' | 'under'): OddsMarket | null {
  const relevant = markets.filter(m => m.market === market && m.side === side && Number.isFinite(m.line));
  if (!relevant.length) return null;
  const counts = new Map<number, number>();
  for (const row of relevant) counts.set(row.line, (counts.get(row.line) ?? 0) + 1);
  const primaryLine = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
  const primary = relevant.filter(row => row.line === primaryLine);
  return primary.reduce((best, current) => current.odds > best.odds ? current : best);
}

/** Fetch odds from The Odds API */
export async function fetchTheOddsAPI(config: OddsProviderConfig): Promise<GameOdds[]> {
  if (!config.theOddsApiKey) {
    console.warn('The Odds API key not configured');
    return [];
  }
  
  const allGames: GameOdds[] = [];
  const sports = config.sports || ['baseball_mlb', 'americanfootball_nfl', 'basketball_nba', 'icehockey_nhl'];
  
  for (const sport of sports) {
    try {
      // Get events
      const eventsUrl = `https://api.the-odds-api.com/v4/sports/${sport}/events?apiKey=${config.theOddsApiKey}`;
      const eventsRes = await fetch(eventsUrl);
      if (!eventsRes.ok) continue;
      const events = await eventsRes.json();
      
      // Get odds for each event
      for (const event of events) {
        const oddsUrl = `https://api.the-odds-api.com/v4/sports/${sport}/events/${event.id}/odds?apiKey=${config.theOddsApiKey}&regions=${(config.regions || ['us']).join(',')}&markets=${(config.markets || ['h2h', 'spreads', 'totals', 'player_props']).join(',')}&bookmakers=${(config.bookmakers || ['pinnacle', 'draftkings', 'fanduel', 'betmgm', 'caesars']).join(',')}`;
        const oddsRes = await fetch(oddsUrl);
        if (!oddsRes.ok) continue;
        const oddsData = await oddsRes.json();
        
        const gameOdds = transformTheOddsAPI(event, oddsData);
        allGames.push(gameOdds);
      }
    } catch (error) {
      console.error(`Failed to fetch odds for ${sport}:`, error);
    }
  }
  
  return allGames;
}

/** Transform The Odds API response to our format */
function transformTheOddsAPI(event: any, oddsData: any): GameOdds {
  const bookmakers = oddsData.bookmakers || [];
  const books = bookmakers.map((b: any) => b.key);
  
  // Extract game lines
  let moneyline = { home: 0, away: 0 };
  let spread = { line: 0, homeOdds: 0, awayOdds: 0 };
  let total = { line: 0, over: 0, under: 0 };
  const playerProps: PlayerOdds[] = [];
  const allMarkets: OddsMarket[] = [];
  
  for (const book of bookmakers) {
    for (const market of book.markets) {
      const bookName = book.key;
      const lastUpdate = book.last_update;
      
      if (market.key === 'h2h') {
        for (const outcome of market.outcomes) {
          if (outcome.name === event.home_team) moneyline.home = outcome.price;
          else if (outcome.name === event.away_team) moneyline.away = outcome.price;
        }
      } else if (market.key === 'spreads') {
        for (const outcome of market.outcomes) {
          if (outcome.name === event.home_team) {
            spread.line = outcome.point;
            spread.homeOdds = outcome.price;
          } else if (outcome.name === event.away_team) {
            spread.awayOdds = outcome.price;
          }
        }
      } else if (market.key === 'totals') {
        for (const outcome of market.outcomes) {
          total.line = outcome.point;
          if (outcome.name === 'Over') total.over = outcome.price;
          else if (outcome.name === 'Under') total.under = outcome.price;
        }
      } else if (market.key.startsWith('player_')) {
        // Player props
        const canonicalMarket = normalizeMarketName(market.key, oddsData.sport || '');
        for (const outcome of market.outcomes) {
          allMarkets.push({
            market: canonicalMarket,
            playerName: String(outcome.description ?? outcome.player ?? outcome.participant ?? '').trim(),
            side: outcome.name.toLowerCase().includes('over') ? 'over' : 'under',
            line: outcome.point,
            odds: outcome.price,
            book: bookName,
            lastUpdated: lastUpdate,
          });
        }
      }
    }
  }
  
  // Group player props by athlete. The Odds API exposes the athlete in
  // outcome.description on player markets; grouping by market/line used to
  // create fake "players" named after the market itself.
  const propsByPlayer = new Map<string, OddsMarket[]>();
  for (const m of allMarkets) {
    if (!m.playerName) continue;
    const key = m.playerName.toLowerCase();
    propsByPlayer.set(key, [...(propsByPlayer.get(key) ?? []), m]);
  }
  for (const markets of propsByPlayer.values()) {
    const first = markets[0];
    const marketNames = [...new Set(markets.map(row => row.market))];
    const bestLines: PlayerOdds['bestLines'] = {};
    for (const marketName of marketNames) {
      bestLines[marketName] = {
        over: findBestLine(markets, marketName, 'over'),
        under: findBestLine(markets, marketName, 'under'),
      };
    }
    playerProps.push({
      playerName: first.playerName ?? '',
      sport: oddsData.sport || '',
      gameId: event.id,
      markets,
      bestLines,
    });
  }
  
  return {
    gameId: event.id,
    sport: oddsData.sport || '',
    homeTeam: event.home_team,
    awayTeam: event.away_team,
    startTime: event.commence_time,
    moneyline,
    spread,
    total,
    playerProps,
    books,
    lastUpdated: new Date().toISOString(),
  };
}

/** Get best available line for a player prop across all books */
export function getBestPlayerPropLine(
  gameOdds: GameOdds,
  playerName: string,
  market: string,
  side: 'over' | 'under',
  line: number
): OddsMarket | null {
  for (const prop of gameOdds.playerProps) {
    // Fuzzy match player name
    if (prop.playerName.toLowerCase().includes(playerName.toLowerCase()) || 
        playerName.toLowerCase().includes(prop.playerName.toLowerCase())) {
      const exact = prop.markets.find(m => 
        m.market === market && m.side === side && m.line === line
      );
      if (exact) return exact;
      
      // Find closest line if exact not available
      return findBestLine(prop.markets, market, side);
    }
  }
  return null;
}

/** Cache for odds data */
const oddsCache = new Map<string, { data: GameOdds[]; expires: number }>();
const CACHE_TTL = 60000; // 1 minute for live odds

/** Get cached or fresh odds */
export async function getOdds(config: OddsProviderConfig): Promise<GameOdds[]> {
  const cacheKey = JSON.stringify(config);
  const cached = oddsCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) {
    return cached.data;
  }
  
  const data = await fetchTheOddsAPI(config);
  oddsCache.set(cacheKey, { data, expires: Date.now() + CACHE_TTL });
  return data;
}

/** Enrich candidate pool with live odds */
export function enrichCandidatesWithOdds(
  candidates: any[],
  odds: GameOdds[]
): any[] {
  // Build lookup by game
  const oddsByGame = new Map<string, GameOdds>();
  for (const game of odds) {
    oddsByGame.set(game.gameId, game);
    // Also index by team names for fuzzy matching
    const key = `${game.awayTeam}_vs_${game.homeTeam}`.toLowerCase();
    oddsByGame.set(key, game);
  }
  
  return candidates.map(candidate => {
    // Try to find matching game odds
    let gameOdds = oddsByGame.get(candidate.eventId);
    if (!gameOdds) {
      const fuzzyKey = `${candidate.awayTeam}_vs_${candidate.homeTeam}`.toLowerCase();
      gameOdds = oddsByGame.get(fuzzyKey);
    }
    
    if (gameOdds) {
      const bestLine = getBestPlayerPropLine(
        gameOdds,
        candidate.playerName,
        candidate.market,
        candidate.side,
        candidate.line
      );
      
      if (bestLine) {
        const implied = americanToImplied(bestLine.odds);
        const edge = candidate.modelProbability - implied;
        return {
          ...candidate,
          odds: bestLine.odds,
          book: bestLine.book,
          impliedProbability: implied,
          estimatedEdge: edge,
          edgeTier: edge > 0.08 ? 'elite' : edge > 0.05 ? 'high' : edge > 0.02 ? 'mid' : 'none',
          lastOddsUpdate: bestLine.lastUpdated,
        };
      }
    }
    
    return candidate;
  });
}