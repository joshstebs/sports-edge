export type Connector<T> =
  | { status: 'ready'; data: T }
  | { status: 'unconfigured' | 'unavailable' };

export interface LineMovement {
  id: string;
  matchup: string;
  market: string;
  type: string;
  detectedAt: string;
  average: number;
  books: number;
}

export interface WorkspaceSnapshot {
  markets: Connector<{ movements: LineMovement[]; total: number }>;
  clv: Connector<{ sample: number; beatClose: number | null }>;
  model: Connector<{ version: string | number | null; auc: number | null }>;
  bankroll: Connector<{ balance: number; growth: number; tracked: number }>;
}

export type LedgerSource = 'SportsEdge' | 'BetTrack' | 'BetIQ';

export interface TrackedSelection {
  id: string;
  name: string;
  eventId: string | null;
  event: string | null;
  eventDate: string | null;
  market: string | null;
  line: number | null;
  americanOdds: number | null;
  status: string | null;
}

export interface TrackedEntry {
  id: string;
  kind: 'saved leg' | 'ticket';
  title: string;
  recordedAt: string | null;
  recordType: 'saved' | 'placed' | 'submitted';
  status: string;
  selections: TrackedSelection[];
  price: { value: number; format: 'american' | 'decimal' } | null;
}

export interface TrackingSource {
  total: number;
  entries: TrackedEntry[];
}

export interface ComparisonResults {
  settled: number;
  wins: number;
  losses: number;
  profit: number | null;
  roi: number | null;
  hitRate: number | null;
}

export interface TrackingSnapshot {
  sources: Record<LedgerSource, Connector<TrackingSource>>;
  comparison: Connector<{ since: string; user: ComparisonResults; model: ComparisonResults }>;
  overlaps: Array<{ ticketId: string; selectionId: string; sportsEdgeIds: string[] }>;
}

export interface PropTrend {
  sport: string;
  market: string;
  side: 'over' | 'under';
  modelVersion: string;
  trainCount: number;
  holdoutCount: number;
  baselineBrier: number;
  adjustedBrier: number;
  adjustment: number;
  active: boolean;
}

export interface PropLearningReport {
  tracked: number;
  pending: number;
  settled: number;
  trends: PropTrend[];
}

export type OddsBoardSport = 'nba' | 'nfl' | 'nhl' | 'mlb';
export type OddsBoardMarket = 'h2h' | 'spreads' | 'totals';

export interface SportsbookQuote {
  book: string;
  odds: number;
  updatedAt: string | null;
}

export interface OddsBoardSelection {
  market: OddsBoardMarket;
  name: string;
  line: number | null;
  quotes: SportsbookQuote[];
}

export interface OddsBoardEvent {
  id: string;
  home: string;
  away: string;
  commenceTime: string;
  selections: OddsBoardSelection[];
}

export interface OddsBoard {
  source: 'the-odds-api' | 'espn' | 'unavailable';
  events: OddsBoardEvent[];
}

export interface GameOddsSnapshot {
  observedAt: string;
  selections: OddsBoardSelection[];
}
