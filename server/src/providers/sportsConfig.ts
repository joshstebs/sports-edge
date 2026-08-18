// Modular sport registry. Sports are data-driven, not hard-coded across the
// app. Each entry declares what SportsEdge knows how to fetch/predict today
// (status: 'live' | 'planned') plus the sport-specific inputs the product
// brief asks for. Adding a league later = one entry here + the matching
// provider/tool wiring — no scattered switch statements.
//
// This module never imports provider internals (keeps the registry cheap to
// load in serverless); it is pure configuration + helpers.

export type SportStatus = 'live' | 'planned';

export interface SportConfig {
  /** Public short code shown in the UI (stable; safe to use as a key). */
  code: string;
  /** Human label. */
  name: string;
  /** ESPN/Stats API family, used to map to providers. */
  family: 'baseball' | 'basketball' | 'football' | 'hockey' | 'soccer' | 'mma';
  status: SportStatus;
  /** What the prediction engine can grade/score today. */
  supportedMarkets: string[];
  /** Sport-specific model inputs the brief calls for. */
  inputs: string[];
  /** Whether player props are meaningfully supported by current data. */
  playerProps: boolean;
}

export const SPORTS: SportConfig[] = [
  {
    code: 'MLB',
    name: 'Baseball',
    family: 'baseball',
    status: 'live',
    supportedMarkets: ['moneyline', 'runline', 'totals', 'teamTotal', 'playerProps'],
    inputs: [
      'starting pitchers',
      'bullpen usage',
      'lineup confirmation',
      'weather',
      'park factors',
      'handedness splits',
      'recent workload',
    ],
    playerProps: true,
  },
  {
    code: 'NFL',
    name: 'Football',
    family: 'football',
    status: 'live',
    supportedMarkets: ['moneyline', 'spread', 'totals', 'playerProps'],
    inputs: [
      'injuries',
      'weather',
      'quarterback status',
      'offensive/defensive efficiency',
      'rest',
      'travel',
      'home field',
      'line movement',
      'matchup statistics',
    ],
    playerProps: true,
  },
  {
    code: 'NBA',
    name: 'Basketball',
    family: 'basketball',
    status: 'live',
    supportedMarkets: ['moneyline', 'spread', 'totals', 'playerProps'],
    inputs: [
      'injuries',
      'starting lineups',
      'minutes',
      'back-to-backs',
      'rest',
      'pace',
      'offensive/defensive rating',
      'player usage',
      'travel',
    ],
    playerProps: true,
  },
  {
    code: 'NHL',
    name: 'Hockey',
    family: 'hockey',
    status: 'live',
    supportedMarkets: ['moneyline', 'puckline', 'totals', 'playerProps'],
    inputs: [
      'goalie confirmation',
      'injuries',
      'rest',
      'back-to-backs',
      'expected goals',
      'special teams',
      'save percentage',
      'home/away splits',
    ],
    playerProps: true,
  },
  {
    code: 'NCAAF',
    name: 'NCAA Football',
    family: 'football',
    status: 'planned',
    supportedMarkets: ['moneyline', 'spread', 'totals'],
    inputs: ['injuries', 'quarterback status', 'offensive/defensive efficiency', 'rest', 'travel', 'home field'],
    playerProps: false,
  },
  {
    code: 'NCAAB',
    name: 'NCAA Basketball',
    family: 'basketball',
    status: 'planned',
    supportedMarkets: ['moneyline', 'spread', 'totals'],
    inputs: ['injuries', 'starting lineups', 'minutes', 'pace', 'offensive/defensive rating', 'travel'],
    playerProps: false,
  },
  {
    code: 'WNBA',
    name: 'WNBA',
    family: 'basketball',
    status: 'planned',
    supportedMarkets: ['moneyline', 'spread', 'totals', 'playerProps'],
    inputs: ['injuries', 'starting lineups', 'minutes', 'pace', 'offensive/defensive rating', 'rest', 'travel'],
    playerProps: true,
  },
  {
    code: 'UFC',
    name: 'UFC / MMA',
    family: 'mma',
    status: 'planned',
    supportedMarkets: ['moneyline'],
    inputs: [
      'fighter statistics',
      'age',
      'reach',
      'style matchup',
      'recent fights',
      'weight class',
      'layoff',
      'striking/grappling metrics',
    ],
    playerProps: false,
  },
  {
    code: 'SOCCER',
    name: 'Soccer',
    family: 'soccer',
    status: 'planned',
    supportedMarkets: ['moneyline', 'spread', 'totals', 'playerProps'],
    inputs: [
      'expected goals',
      'injuries',
      'suspensions',
      'lineups',
      'form',
      'home/away performance',
      'rest',
      'competition strength',
    ],
    playerProps: true,
  },
];

export const LIVE_SPORT_CODES = SPORTS.filter((s) => s.status === 'live').map((s) => s.code);

const BY_CODE = new Map(SPORTS.map((s) => [s.code.toUpperCase(), s]));

export function getSportConfig(code: string): SportConfig | undefined {
  return BY_CODE.get(code.toUpperCase());
}

export function isKnownSport(code: string): boolean {
  return BY_CODE.has(code.toUpperCase());
}

export function sportInputs(code: string): string[] | null {
  return getSportConfig(code)?.inputs ?? null;
}
