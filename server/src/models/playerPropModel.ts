/**
 * Deterministic cross-sport player-prop model.
 *
 * This module never fetches data and never invents missing observations. It
 * transforms official per-game histories into a transparent empirical model.
 * The caller remains responsible for the mandatory current availability gate.
 */

export type ModelSport = 'mlb' | 'nfl' | 'nba' | 'nhl';
export type ModelSide = 'over' | 'under';

export interface HistoricalObservation {
  date?: string | null;
  value: number;
}

export interface PlayerPropModelInput {
  sport: ModelSport;
  market: string;
  side: ModelSide;
  line: number;
  observations: HistoricalObservation[];
  americanOdds?: number | null;
  source: string;
  calibration?: { n: number; averageConfidence: number | null; hitRate: number } | null;
}

export interface PlayerPropModelResult {
  available: boolean;
  reason?: string;
  modelVersion: 'empirical-beta-v1';
  sport: ModelSport;
  market: string;
  side: ModelSide;
  line: number;
  source: string;
  sampleSize: number;
  wins?: number;
  losses?: number;
  pushes?: number;
  probability?: number;
  rawProbability?: number;
  pOver?: number;
  pUnder?: number;
  pPush?: number;
  average?: number;
  median?: number;
  standardDeviation?: number | null;
  recentAverage?: number;
  grade?: 'A' | 'B' | 'C' | 'D';
  impliedProbability?: number | null;
  estimatedEdge?: number | null;
  method?: string;
  warning?: string;
  calibrationApplied?: { n: number; historicalBias: number; adjustment: number } | null;
}

const MIN_SAMPLE: Record<ModelSport, number> = { mlb: 8, nfl: 5, nba: 8, nhl: 8 };

function round(value: number, places = 3): number {
  return Math.round(value * 10 ** places) / 10 ** places;
}

function americanImplied(odds: number | null | undefined): number | null {
  if (odds == null || !Number.isFinite(odds) || odds === 0) return null;
  return odds > 0 ? 100 / (odds + 100) : -odds / (-odds + 100);
}

function grade(probability: number, sampleSize: number): 'A' | 'B' | 'C' | 'D' {
  // Keep the displayed/tool grade aligned with the same thresholds used by
  // the prompt, parlay gate, and frontend. Sample gates still prevent a short
  // hot streak from receiving an A/B recommendation label.
  if (sampleSize >= 15 && probability >= 0.65) return 'A';
  if (sampleSize >= 10 && probability >= 0.58) return 'B';
  if (probability >= 0.5) return 'C';
  return 'D';
}

export function normalizeMarket(value: string): string {
  const key = value.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const aliases: Record<string, string> = {
    hit: 'hits', hits: 'hits', totalbase: 'totalBases', totalbases: 'totalBases',
    homerun: 'homeRuns', homeruns: 'homeRuns', hr: 'homeRuns', rbi: 'rbi', runs: 'runs',
    strikeout: 'strikeouts', strikeouts: 'strikeouts', pitcherstrikeouts: 'strikeouts',
    walk: 'walks', walks: 'walks', stolenbase: 'stolenBases', stolenbases: 'stolenBases',
    earnedrun: 'earnedRuns', earnedruns: 'earnedRuns', hitsallowed: 'hitsAllowed',
    walksallowed: 'walksAllowed', outsrecorded: 'outsRecorded',
    point: 'points', points: 'points', rebound: 'rebounds', rebounds: 'rebounds',
    assist: 'assists', assists: 'assists', threepointersmade: 'threePointersMade', threes: 'threePointersMade',
    pointsreboundsassists: 'pointsReboundsAssists', pra: 'pointsReboundsAssists',
    pointsrebounds: 'pointsRebounds', pr: 'pointsRebounds', pointsassists: 'pointsAssists', pa: 'pointsAssists',
    reboundsassists: 'reboundsAssists', ra: 'reboundsAssists', blocks: 'blocks', steals: 'steals',
    passingyards: 'passingYards', passingtouchdowns: 'passingTouchdowns', passingtds: 'passingTouchdowns',
    rushingyards: 'rushingYards', receivingyards: 'receivingYards', receptions: 'receptions',
    rushingreceivingyards: 'rushingReceivingYards', rushreceivingyards: 'rushingReceivingYards',
    anytimetouchdown: 'touchdowns', touchdowns: 'touchdowns',
    goal: 'goals', goals: 'goals', shot: 'shotsOnGoal', shots: 'shotsOnGoal', shotsongoal: 'shotsOnGoal',
    hockeypoints: 'hockeyPoints', saves: 'saves', goalsagainst: 'goalsAgainst', blockedshots: 'blockedShots',
  };
  return aliases[key] ?? value.trim();
}

export function buildPlayerPropModel(input: PlayerPropModelInput): PlayerPropModelResult {
  const market = normalizeMarket(input.market);
  const base = {
    modelVersion: 'empirical-beta-v1' as const, sport: input.sport, market,
    side: input.side, line: input.line, source: input.source,
  };
  if (!Number.isFinite(input.line) || input.line < 0) {
    return { ...base, available: false, reason: 'A valid non-negative sportsbook line is required.', sampleSize: 0 };
  }
  const values = input.observations.map((row) => row.value).filter((value) => Number.isFinite(value) && value >= 0);
  if (values.length < MIN_SAMPLE[input.sport]) {
    return {
      ...base, available: false, sampleSize: values.length,
      reason: `Insufficient real game history: ${values.length} observations; ${MIN_SAMPLE[input.sport]} required for ${input.sport.toUpperCase()}.`,
    };
  }
  const overs = values.filter((value) => value > input.line).length;
  const unders = values.filter((value) => value < input.line).length;
  const pushes = values.length - overs - unders;
  let pOver: number;
  let pUnder: number;
  let pPush: number;
  if (pushes === 0) {
    // Beta(2,2) prior: transparent shrinkage toward 50%, suitable for half-lines.
    pOver = (overs + 2) / (values.length + 4);
    pUnder = 1 - pOver;
    pPush = 0;
  } else {
    // Integer lines can push. Symmetric Dirichlet(1,1,1) smoothing preserves
    // separate over/under/push probabilities instead of treating pushes as losses.
    pOver = (overs + 1) / (values.length + 3);
    pUnder = (unders + 1) / (values.length + 3);
    pPush = (pushes + 1) / (values.length + 3);
  }
  const rawProbability = input.side === 'over' ? pOver : pUnder;
  let probability = rawProbability;
  let calibrationApplied: PlayerPropModelResult['calibrationApplied'] = null;
  const calibration = input.calibration;
  if (calibration && calibration.n >= 20 && calibration.averageConfidence != null) {
    const historicalBias = (calibration.averageConfidence - calibration.hitRate) / 100;
    const reliability = Math.min(0.75, calibration.n / (calibration.n + 50));
    const adjustment = Math.max(-0.1, Math.min(0.1, -historicalBias * reliability));
    probability = Math.max(0.02, Math.min(0.98, rawProbability + adjustment));
    calibrationApplied = { n: calibration.n, historicalBias: round(historicalBias), adjustment: round(adjustment) };
  }
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const sorted = [...values].sort((a, b) => a - b);
  const midpoint = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[midpoint] : (sorted[midpoint - 1] + sorted[midpoint]) / 2;
  const variance = values.length > 1
    ? values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1) : 0;
  const recentN = Math.max(3, Math.ceil(values.length / 3));
  const recentAverage = values.slice(0, recentN).reduce((sum, value) => sum + value, 0) / recentN;
  const impliedProbability = americanImplied(input.americanOdds);
  const estimatedEdge = impliedProbability == null ? null : probability - impliedProbability;
  return {
    ...base, available: true, sampleSize: values.length,
    wins: input.side === 'over' ? overs : unders,
    losses: input.side === 'over' ? unders : overs,
    pushes, probability: round(probability), rawProbability: round(rawProbability), pOver: round(pOver), pUnder: round(pUnder), pPush: round(pPush),
    average: round(mean), median: round(median), standardDeviation: round(Math.sqrt(variance)),
    recentAverage: round(recentAverage), grade: grade(probability, values.length),
    impliedProbability: impliedProbability == null ? null : round(impliedProbability),
    estimatedEdge: estimatedEdge == null ? null : round(estimatedEdge),
    calibrationApplied,
    method: pushes === 0
      ? 'Beta-binomial empirical hit rate with Beta(2,2) shrinkage over official recent game logs.'
      : 'Dirichlet-smoothed empirical over/under/push rates over official recent game logs.',
    warning: impliedProbability == null
      ? 'No verified prop odds were supplied, so this is a historical probability estimate—not a claim of positive expected value.'
      : 'Historical estimate only; availability and current matchup context must remain verified at recommendation time.',
  };
}

function numeric(stats: Record<string, any>, ...keys: string[]): number | null {
  for (const key of keys) {
    const raw = stats[key];
    if (raw == null || raw === '') continue;
    const value = Number(String(raw).replace(/,/g, ''));
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function madeFromComposite(stats: Record<string, any>, ...keys: string[]): number | null {
  for (const key of keys) {
    const raw = String(stats[key] ?? '');
    const match = /^(\d+)\s*-/.exec(raw);
    if (match) return Number(match[1]);
  }
  return null;
}

/** Extract a supported market value from one ESPN gamelog row. Null means the
 * source did not publish that field; callers must drop it, never replace with 0. */
export function espnObservation(sport: Exclude<ModelSport, 'mlb'>, marketInput: string, stats: Record<string, any>): number | null {
  const market = normalizeMarket(marketInput);
  const sum = (...values: Array<number | null>) => values.every((value) => value != null)
    ? values.reduce<number>((total, value) => total + (value as number), 0) : null;
  if (sport === 'nba') {
    const points = numeric(stats, 'points'); const rebounds = numeric(stats, 'totalRebounds', 'rebounds');
    const assists = numeric(stats, 'assists');
    const map: Record<string, number | null> = {
      points, rebounds, assists, steals: numeric(stats, 'steals'), blocks: numeric(stats, 'blocks'),
      threePointersMade: numeric(stats, 'threePointFieldGoalsMade') ?? madeFromComposite(stats, 'threePointFieldGoalsMade-threePointFieldGoalsAttempted'),
      pointsReboundsAssists: sum(points, rebounds, assists), pointsRebounds: sum(points, rebounds),
      pointsAssists: sum(points, assists), reboundsAssists: sum(rebounds, assists),
    };
    return map[market] ?? null;
  }
  if (sport === 'nfl') {
    const rushing = numeric(stats, 'rushingYards'); const receiving = numeric(stats, 'receivingYards');
    // Standard anytime/player-TD props exclude passing touchdowns.
    const touchdownParts = [numeric(stats, 'rushingTouchdowns'), numeric(stats, 'receivingTouchdowns')];
    const touchdowns = touchdownParts.some((value) => value != null)
      ? touchdownParts.reduce<number>((total, value) => total + (value ?? 0), 0) : null;
    const map: Record<string, number | null> = {
      passingYards: numeric(stats, 'passingYards'), passingTouchdowns: numeric(stats, 'passingTouchdowns'),
      rushingYards: rushing, receivingYards: receiving, receptions: numeric(stats, 'receptions'),
      rushingReceivingYards: sum(rushing, receiving), touchdowns,
    };
    return map[market] ?? null;
  }
  const goals = numeric(stats, 'goals'); const assists = numeric(stats, 'assists');
  const map: Record<string, number | null> = {
    goals, assists, points: numeric(stats, 'points') ?? sum(goals, assists),
    hockeyPoints: numeric(stats, 'points') ?? sum(goals, assists),
    shotsOnGoal: numeric(stats, 'shots', 'shotsOnGoal'), saves: numeric(stats, 'saves'),
    goalsAgainst: numeric(stats, 'goalsAgainst'), blockedShots: numeric(stats, 'blockedShots', 'blocked'),
  };
  return map[market] ?? null;
}

export function mlbObservation(marketInput: string, stats: Record<string, any>): number | null {
  const market = normalizeMarket(marketInput);
  const hits = numeric(stats, 'hits');
  const totalBases = numeric(stats, 'totalBases') ?? (hits == null ? null
    : hits + (numeric(stats, 'doubles') ?? 0) + 2 * (numeric(stats, 'triples') ?? 0) + 3 * (numeric(stats, 'homeRuns') ?? 0));
  const innings = String(stats.inningsPitched ?? '');
  const outsRecorded = /^\d+(?:\.[0-2])?$/.test(innings)
    ? Number(innings.split('.')[0]) * 3 + Number(innings.split('.')[1] ?? 0) : null;
  const map: Record<string, number | null> = {
    hits, totalBases, homeRuns: numeric(stats, 'homeRuns'), rbi: numeric(stats, 'rbi'),
    runs: numeric(stats, 'runs'), walks: numeric(stats, 'baseOnBalls'), stolenBases: numeric(stats, 'stolenBases'),
    strikeouts: numeric(stats, 'strikeOuts'), earnedRuns: numeric(stats, 'earnedRuns'),
    hitsAllowed: numeric(stats, 'hits'), walksAllowed: numeric(stats, 'baseOnBalls'), outsRecorded,
  };
  return map[market] ?? null;
}
