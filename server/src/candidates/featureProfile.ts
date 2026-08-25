import type { ModelSport } from '../models/playerPropModel.js';

export interface FeatureWindow {
  n: number;
  average: number | null;
  hitRateOverSuggestedLine: number | null;
}

export interface PlayerFeatureProfile {
  sport: ModelSport;
  player: string;
  team: string | null;
  opponent: string | null;
  eventId: string | number | null;
  eventDate: string;
  role: string | null;
  availability: {
    status: 'verified' | 'provisional' | 'unknown';
    reason: string | null;
  };
  recent: {
    last5: FeatureWindow | null;
    last10: FeatureWindow | null;
    last20: FeatureWindow | null;
  };
  season: Record<string, unknown> | null;
  matchup: Record<string, unknown>;
  context: {
    homeAway: 'home' | 'away' | null;
    restDays: number | null;
    expectedPlayingTime: number | null;
    lineupSlot: number | null;
    weather: Record<string, unknown> | null;
    venueFactor: Record<string, unknown> | null;
  };
  market: {
    market: string;
    suggestedLine: number;
    side: 'over' | 'under';
    modelProbability: number;
    grade: 'A' | 'B' | 'C' | 'D';
    sampleSize: number;
    impliedProbability: number | null;
    estimatedEdge: number | null;
    modelVersion: string;
  };
  sources: string[];
  fallbackUsed: boolean;
  retrievedAt: string;
}

export function featureWindow(values: number[], line: number, n: number): FeatureWindow | null {
  const sample = values.slice(0, n).filter(Number.isFinite);
  if (!sample.length) return null;
  return {
    n: sample.length,
    average: Math.round((sample.reduce((sum, value) => sum + value, 0) / sample.length) * 1000) / 1000,
    hitRateOverSuggestedLine: Math.round((sample.filter((value) => value > line).length / sample.length) * 1000) / 1000,
  };
}
