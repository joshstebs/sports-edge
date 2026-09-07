/**
 * Central prop identity and line-integrity rules.
 *
 * A sportsbook line is only actionable when its market is one of the
 * explicitly supported player-stat markets for the sport and the line is a
 * finite half-point/integer within a broad sport/market range. These are
 * sanity bounds, not a whitelist of today's lines: legitimate alternates
 * remain eligible, while malformed rows and cross-market ladder leakage do
 * not become recommendations.
 */
export type PropSport = 'mlb' | 'nba' | 'nfl' | 'nhl';

type MarketBounds = { min: number; max: number };

const ALIASES: Record<string, string> = {
  hit: 'hits', hits: 'hits', batterhit: 'hits', batterhits: 'hits', playerhit: 'hits', playerhits: 'hits', totalhit: 'hits', totalhits: 'hits',
  totalbase: 'totalBases', totalbases: 'totalBases', battertotalbase: 'totalBases', battertotalbases: 'totalBases', playertotalbase: 'totalBases', playertotalbases: 'totalBases',
  homerun: 'homeRuns', homeruns: 'homeRuns', batterhomerun: 'homeRuns', batterhomeruns: 'homeRuns', playerhomerun: 'homeRuns', playerhomeruns: 'homeRuns', hr: 'homeRuns',
  rbi: 'rbi', batterrbi: 'rbi', batterrbis: 'rbi', runs: 'runs', run: 'runs', batterrun: 'runs', batterruns: 'runs', batterrunsscored: 'runs', batterrunsscoreds: 'runs',
  strikeout: 'strikeouts', strikeouts: 'strikeouts', pitcherstrikeout: 'strikeouts', pitcherstrikeouts: 'strikeouts', playerstrikeout: 'strikeouts', playerstrikeouts: 'strikeouts',
  outsrecorded: 'outsRecorded', pitcherouts: 'outsRecorded', pitcheroutsrecorded: 'outsRecorded',
  points: 'points', point: 'points', rebounds: 'rebounds', rebound: 'rebounds', assists: 'assists', assist: 'assists',
  threepointersmade: 'threePointersMade', threepointermade: 'threePointersMade', threes: 'threePointersMade',
  pointsreboundsassists: 'pointsReboundsAssists', pra: 'pointsReboundsAssists',
  passingyards: 'passingYards', passingtouchdowns: 'passingTouchdowns', passingtds: 'passingTouchdowns',
  rushingyards: 'rushingYards', receivingyards: 'receivingYards', receptions: 'receptions', rushingreceivingyards: 'rushingReceivingYards',
  touchdown: 'touchdowns', touchdowns: 'touchdowns', anytimetouchdown: 'touchdowns',
  goals: 'goals', goal: 'goals', shotsongoal: 'shotsOnGoal', shots: 'shotsOnGoal', shot: 'shotsOnGoal',
  hockeypoints: 'hockeyPoints', saves: 'saves',
};

const BOUNDS: Record<PropSport, Record<string, MarketBounds>> = {
  mlb: {
    hits: { min: 0, max: 5.5 }, totalBases: { min: 0, max: 10.5 }, homeRuns: { min: 0, max: 3.5 },
    rbi: { min: 0, max: 6.5 }, runs: { min: 0, max: 6.5 }, strikeouts: { min: 0, max: 20.5 }, outsRecorded: { min: 0, max: 30.5 },
  },
  nba: {
    points: { min: 0, max: 100.5 }, rebounds: { min: 0, max: 50.5 }, assists: { min: 0, max: 40.5 },
    threePointersMade: { min: 0, max: 25.5 }, pointsReboundsAssists: { min: 0, max: 180.5 },
  },
  nfl: {
    passingYards: { min: 0, max: 650.5 }, passingTouchdowns: { min: 0, max: 10.5 },
    rushingYards: { min: 0, max: 350.5 }, receivingYards: { min: 0, max: 400.5 },
    receptions: { min: 0, max: 30.5 }, rushingReceivingYards: { min: 0, max: 450.5 }, touchdowns: { min: 0, max: 8.5 },
  },
  nhl: {
    goals: { min: 0, max: 8.5 }, assists: { min: 0, max: 8.5 }, hockeyPoints: { min: 0, max: 12.5 },
    shotsOnGoal: { min: 0, max: 25.5 }, saves: { min: 0, max: 100.5 },
  },
};

function compact(value: unknown): string {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function canonicalPropMarket(value: unknown, sport?: string): string | null {
  const market = ALIASES[compact(value)];
  if (!market) return null;
  if (!sport) return market;
  const bounds = BOUNDS[String(sport).toLowerCase() as PropSport]?.[market];
  return bounds ? market : null;
}

export function propLineIntegrity(sport: string, marketValue: unknown, lineValue: unknown): {
  valid: boolean;
  market: string | null;
  line: number | null;
  reason?: string;
} {
  const normalizedSport = String(sport).toLowerCase() as PropSport;
  const market = canonicalPropMarket(marketValue, normalizedSport);
  if (!market) return { valid: false, market: null, line: null, reason: 'unsupported player-prop market' };
  const line = Number(lineValue);
  if (!Number.isFinite(line) || line < 0) return { valid: false, market, line: null, reason: 'line is not a finite non-negative number' };
  if (Math.abs(line * 2 - Math.round(line * 2)) > 1e-9) return { valid: false, market, line, reason: 'line is not an integer or half-point' };
  const bounds = BOUNDS[normalizedSport]?.[market];
  if (!bounds || line < bounds.min || line > bounds.max) return { valid: false, market, line, reason: 'line is outside the broad market sanity range' };
  return { valid: true, market, line };
}

export function isPlausiblePropLine(sport: string, market: unknown, line: unknown): boolean {
  return propLineIntegrity(sport, market, line).valid;
}
