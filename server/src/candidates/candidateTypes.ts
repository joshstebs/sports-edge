// Centralized type definitions for the candidate pool system

// Core types for candidate legs and pools
export interface CandidateLeg {
  entity_type: 'player' | 'team' | 'game';
  player_name?: string;
  sport: string;
  game: string;
  game_date: string;
  event_id: string;
  selection: string;
  market: string;
  side: 'over' | 'under';
  line: number;
  odds: number | null;
  game_odds: string | null;
  justification: string;
  risk: 'Low' | 'Medium' | 'High';
  correlation: string;
  confidence: number;
}

export interface CandidatePool {
  candidates: CandidateLeg[];
  totalEvaluated: number;
  filtersApplied: Record<string, any>;
}

export interface SgpLegInput {
  entity_type: 'player' | 'team' | 'game';
  player_name?: string;
  sport: string;
  game: string;
  game_date: string;
  event_id: string;
  selection: string;
  market: string;
  side: 'over' | 'under';
  line: number;
  odds: number | null;
  game_odds: string | null;
  justification: string;
  risk: 'Low' | 'Medium' | 'High';
  correlation: string;
  confidence: number;
}

export interface SgpBlock {
  legs: SgpLegInput[];
}

export interface PredictionLog {
  prediction_id: string;
  timestamp: string;
  game_date: string;
  event_id: string;
  sport: string;
  matchup: string;
  bet_type: string;
  legs: Array<{
    entity_type: 'player' | 'team' | 'game';
    player_name: string;
    leg_name: string;
    player_id: string | null;
    market: string;
    side: 'over' | 'under';
    line: number;
    target_line: string;
    model_probability: string;
    model_version: string;
    model_sample_size: number;
    model_source: string;
    implied_odds: string | null;
    key_metric_used: string;
  }>;
  recommended_units: string;
}

export interface ParsedIntent {
  sport: string;
  wagerType: string;
  category: string;
  requestedLegs?: number;
  timeframe: string;
  riskLevel: string;
  description: string | undefined;
}

export interface ValidationResult {
  valid: boolean;
  intent: ParsedIntent;
  sgpBlocks: SgpBlock[];
  predictionLogs: PredictionLog[];
  totalLegs: number;
  errors: string[];
  warnings: string[];
}

export interface RepairResult {
  success: boolean;
  sgpBlocks: SgpBlock[];
  predictionLogs: PredictionLog[];
  attempts: number;
  finalError?: string;
}

export interface PlayerPropModelV3Result {
  probability: number;
  modelVersion: string;
  modelSampleSize: number;
  modelSource: string;
  impliedOdds: string | null;
  keyMetricUsed: string;
  grade: 'A' | 'B' | 'C' | 'D';
}

export type ModelSport = 'mlb' | 'nfl' | 'nba' | 'nhl';