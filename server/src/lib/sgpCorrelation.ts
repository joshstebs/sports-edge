// SGPN (Same-Game Parlay) Correlation Engine
// Models dependency between correlated props in same-game parlays
// Positive correlation: both legs likely to hit together
// Negative correlation: one leg's outcome affects another's probability

import { CandidateLeg } from '../candidates/candidateTypes.js';
import { GameOdds } from '../providers/oddsAggregator.js';

export type CorrelationDirection = 'positive' | 'negative' | 'neutral';

export interface CorrelationRule {
  market1: string;
  side1: 'over' | 'under';
  market2: string;
  side2: 'over' | 'under';
  direction: CorrelationDirection;
  strength: number;     // 0.0 to 1.0 - how strong the correlation is
  reason: string;
  sport: string;
}

export interface CorrelationScore {
  leg1: CandidateLeg;
  leg2: CandidateLeg;
  correlation: CorrelationDirection;
  strength: number;
  combinedProbability: number;   // Adjusted prob considering correlation
  clvAdjustment: number;         // How correlation affects CLV
  reason: string;
}

export interface SgpCorrelationAnalysis {
  legs: CandidateLeg[];
  correlationScores: CorrelationScore[];
  overallCorrelation: number;    // Average absolute correlation strength
  combinedClvMultiplier: number; // How correlation amplifies/reduces value
  recommendation: 'favorable' | 'caution' | 'avoid';
  explanation: string;
}

/** Sport-specific correlation rules */
export const CORRELATION_RULES: CorrelationRule[] = [
  // MLB correlations
  {
    market1: 'player_home_runs', side1: 'over',
    market2: 'player_hits', side2: 'over',
    direction: 'positive', strength: 0.85,
    reason: 'A home run also counts as a hit; over on HRs strongly implies over on hits',
    sport: 'mlb',
  },
  {
    market1: 'player_home_runs', side1: 'over',
    market2: 'player_runs', side2: 'over',
    direction: 'positive', strength: 0.80,
    reason: 'Home run scorers typically also score runs',
    sport: 'mlb',
  },
  {
    market1: 'player_rbi', side1: 'over',
    market2: 'player_runs', side2: 'over',
    direction: 'positive', strength: 0.70,
    reason: 'RBI-producing batters are typically on teams that score runs',
    sport: 'mlb',
  },
  {
    market1: 'player_strikeouts', side1: 'over',
    market2: 'opponent_player_hits_allowed', side2: 'over',
    direction: 'positive', strength: 0.65,
    reason: 'Pitcher strikeouts correlate with more balls in play, potentially more hits allowed',
    sport: 'mlb',
  },
  {
    market1: 'player_errors', side1: 'over',
    market2: 'opponent_player_runs', side2: 'over',
    direction: 'positive', strength: 0.55,
    reason: 'Fielding errors lead to extra baserunners and runs',
    sport: 'mlb',
  },
  // NFL correlations
  {
    market1: 'player_pass_yards', side1: 'over',
    market2: 'player_receiving_yards', side2: 'over',
    direction: 'positive', strength: 0.80,
    reason: 'More passing yards typically means more receiving yards for targets',
    sport: 'nfl',
  },
  {
    market1: 'player_pass_yards', side1: 'over',
    market2: 'player_pass_tds', side2: 'over',
    direction: 'positive', strength: 0.75,
    reason: 'More passing yards typically yield more touchdown passes',
    sport: 'nfl',
  },
  {
    market1: 'player_rush_yards', side1: 'over',
    market2: 'player_rush_tds', side2: 'over',
    direction: 'positive', strength: 0.70,
    reason: 'More rushing yards typically yield more rushing touchdowns',
    sport: 'nfl',
  },
  {
    market1: 'player_pass_tds', side1: 'over',
    market2: 'game_total_points', side2: 'over',
    direction: 'positive', strength: 0.75,
    reason: 'More touchdown passes contribute to higher total scores',
    sport: 'nfl',
  },
  {
    market1: 'total_turnovers', side1: 'over',
    market2: 'opponent_team_total_points', side2: 'over',
    direction: 'positive', strength: 0.60,
    reason: 'More turnovers give opponents more scoring opportunities',
    sport: 'nfl',
  },
  // NBA correlations
  {
    market1: 'player_points', side1: 'over',
    market2: 'player_threes_made', side2: 'over',
    direction: 'positive', strength: 0.65,
    reason: 'Three-pointers are a subset of points; over threes typically implies over points',
    sport: 'nba',
  },
  {
    market1: 'player_points', side1: 'over',
    market2: 'player_assists', side2: 'over',
    direction: 'positive', strength: 0.55,
    reason: 'Scoring players often create assists for teammates, but less directly correlated',
    sport: 'nba',
  },
  {
    market1: 'player_rebounds', side1: 'over',
    market2: 'game_total_points', side2: 'over',
    direction: 'positive', strength: 0.50,
    reason: 'More rebound opportunities often come in higher-paced, higher-scoring games',
    sport: 'nba',
  },
  {
    market1: 'player_turnovers', side1: 'over',
    market2: 'opponent_team_points', side2: 'over',
    direction: 'positive', strength: 0.45,
    reason: 'Turnovers give opponents more possessions and scoring chances',
    sport: 'nba',
  },
  // NHL correlations
  {
    market1: 'player_shots', side1: 'over',
    market2: 'player_goals', side2: 'over',
    direction: 'positive', strength: 0.60,
    reason: 'More shots on goal create more scoring opportunities',
    sport: 'nhl',
  },
  {
    market1: 'player_goals', side1: 'over',
    market2: 'team_total_goals', side2: 'over',
    direction: 'positive', strength: 0.80,
    reason: 'Individual goals directly contribute to team scoring totals',
    sport: 'nhl',
  },
  {
    market1: 'player_assists', side1: 'over',
    market2: 'team_total_goals', side2: 'over',
    direction: 'positive', strength: 0.75,
    reason: 'Assists are a component of team scoring',
    sport: 'nhl',
  },
  {
    market1: 'goalie_goals_against', side1: 'over',
    market2: 'opponent_team_total_goals', side2: 'over',
    direction: 'positive', strength: 0.85,
    reason: 'Goals against directly equal opponent team goals scored',
    sport: 'nhl',
  },
];

/** Check if two legs have a defined correlation */
export function findCorrelation(
  leg1: CandidateLeg,
  leg2: CandidateLeg
): { direction: CorrelationDirection; strength: number; reason: string } | null {
  const sport = leg1.sport.toLowerCase();
  const market1 = leg1.market?.toLowerCase() || '';
  const market2 = leg2.market?.toLowerCase() || '';
  const side1 = leg1.side;
  const side2 = leg2.side;
  
  // Check direct match
  const direct = CORRELATION_RULES.find(r =>
    r.sport === sport &&
    normalizeMarket(r.market1) === normalizeMarket(market1) &&
    r.side1 === side1 &&
    normalizeMarket(r.market2) === normalizeMarket(market2) &&
    r.side2 === side2
  );
  
  if (direct) {
    return { direction: direct.direction, strength: direct.strength, reason: direct.reason };
  }
  
  // Check reversed match
  const reversed = CORRELATION_RULES.find(r =>
    r.sport === sport &&
    normalizeMarket(r.market1) === normalizeMarket(market2) &&
    r.side1 === side2 &&
    normalizeMarket(r.market2) === normalizeMarket(market1) &&
    r.side2 === side1
  );
  
  if (reversed) {
    return { direction: reversed.direction, strength: reversed.strength, reason: reversed.reason };
  }
  
  return null;
}

/** Normalize market name for comparison */
function normalizeMarket(market: string): string {
  const aliases: Record<string, string> = {
    'player_hits': 'hits',
    'player_home_runs': 'home_runs',
    'player_rbis': 'rbis',
    'player_runs': 'runs',
    'player_walks': 'walks',
    'player_strikeouts': 'strikeouts',
    'player_pass_yards': 'pass_yards',
    'player_receiving_yards': 'receiving_yards',
    'player_rush_yards': 'rush_yards',
    'player_pass_tds': 'pass_tds',
    'player_rush_tds': 'rush_tds',
    'player_receptions': 'receptions',
    'player_points': 'points',
    'player_rebounds': 'rebounds',
    'player_assists': 'assists',
    'player_threes_made': 'threes_made',
    'player_steals': 'steals',
    'player_blocks': 'blocks',
    'player_turnovers': 'turnovers',
    'player_goals': 'goals',
    'player_shots': 'shots',
    'player_saves': 'saves',
    'goalie_goals_against': 'goals_against',
    'total_turnovers': 'turnovers',
    'opponent_player_hits_allowed': 'hits_allowed',
    'opponent_player_runs': 'opponent_runs',
    'opponent_team_total_points': 'opponent_points',
    'opponent_team_points': 'opponent_points',
    'game_total_points': 'total_points',
    'team_total_goals': 'team_goals',
    'opponent_team_total_goals': 'opponent_goals',
  };
  return aliases[market] || market;
}

/** Compute joint probability considering correlation */
export function correlatedJointProbability(
  probA: number,
  probB: number,
  correlation: CorrelationDirection,
  strength: number
): number {
  // Independent case
  if (correlation === 'neutral' || strength === 0) {
    return probA * probB;
  }
  
  // Correlated case - adjust joint probability
  const sign = correlation === 'positive' ? 1 : -1;
  
  // Formula: P(A and B) = P(A) * P(B) + s * sqrt(P(A)(1-P(A)) * P(B)(1-P(B)))
  // where s is the signed correlation strength
  const covariance = sign * strength * Math.sqrt(probA * (1 - probA) * probB * (1 - probB));
  return Math.max(0, Math.min(1, probA * probB + covariance));
}

/** Analyze a set of legs for correlation effects */
export function analyzeSgpCorrelation(legs: CandidateLeg[]): SgpCorrelationAnalysis {
  const correlationScores: CorrelationScore[] = [];
  
  for (let i = 0; i < legs.length; i++) {
    for (let j = i + 1; j < legs.length; j++) {
      const leg1 = legs[i];
      const leg2 = legs[j];
      
      const corr = findCorrelation(leg1, leg2);
      if (!corr) continue;
      
      const prob1 = leg1.confidence / 100;
      const prob2 = leg2.confidence / 100;
      
      const combinedProb = correlatedJointProbability(prob1, prob2, corr.direction, corr.strength);
      
      // CLV adjustment: positive correlation can amplify value in SGPs
      const clvAdj = corr.direction === 'positive' ? corr.strength * 0.15 : -corr.strength * 0.1;
      
      correlationScores.push({
        leg1,
        leg2,
        correlation: corr.direction,
        strength: corr.strength,
        combinedProbability: combinedProb,
        clvAdjustment: clvAdj,
        reason: corr.reason,
      });
    }
  }
  
  if (!correlationScores.length) {
    return {
      legs,
      correlationScores,
      overallCorrelation: 0,
      combinedClvMultiplier: 1,
      recommendation: 'favorable',
      explanation: 'No significant correlations between legs detected.',
    };
  }
  
  // Compute overall correlation metrics
  const avgStrength = correlationScores.reduce((sum, cs) => sum + cs.strength, 0) / correlationScores.length;
  const positiveCorr = correlationScores.filter(cs => cs.correlation === 'positive');
  const negativeCorr = correlationScores.filter(cs => cs.correlation === 'negative');
  
  // Calculate combined CLV multiplier
  const clvMultiplier = 1 + (positiveCorr.reduce((sum, cs) => sum + cs.clvAdjustment, 0) -
    negativeCorr.reduce((sum, cs) => sum + Math.abs(cs.clvAdjustment), 0)) / correlationScores.length;
  
  // Determine recommendation
  let recommendation: 'favorable' | 'caution' | 'avoid';
  let explanation: string;
  
  const strongNegativeRatio = negativeCorr.length / correlationScores.length;
  const avgPositiveStrength = positiveCorr.length ? positiveCorr.reduce((sum, cs) => sum + cs.strength, 0) / positiveCorr.length : 0;
  
  if (strongNegativeRatio > 0.5 && avgStrength > 0.6) {
    recommendation = 'avoid';
    explanation = `High ratio of negative correlations (${(strongNegativeRatio * 100).toFixed(0)}%) with average strength ${avgStrength.toFixed(2)}. Legs work against each other.`;
  } else if (avgStrength > 0.7 && avgPositiveStrength > 0.6) {
    recommendation = 'favorable';
    explanation = `Strong positive correlations detected (avg strength ${avgStrength.toFixed(2)}). Legs compound value in same-game parlay.`;
  } else if (avgStrength > 0.5) {
    recommendation = 'caution';
    explanation = `Moderate correlations present (avg strength ${avgStrength.toFixed(2)}. Some legs may be dependent.`;
  } else {
    recommendation = 'favorable';
    explanation = `Weak correlations (avg strength ${avgStrength.toFixed(2)}. Legs are largely independent.`;
  }
  
  return {
    legs,
    correlationScores,
    overallCorrelation: avgStrength,
    combinedClvMultiplier: Math.max(0.5, Math.min(2.0, clvMultiplier)),
    recommendation,
    explanation,
  };
}

/** Get correlation explanation for UI display */
export function getCorrelationExplanation(analysis: SgpCorrelationAnalysis): string {
  const parts: string[] = [];
  
  if (!analysis.correlationScores.length) {
    return 'No significant correlations detected between these legs.';
  }
  
  const positive = analysis.correlationScores.filter(cs => cs.correlation === 'positive');
  const negative = analysis.correlationScores.filter(cs => cs.correlation === 'negative');
  
  if (positive.length) {
    parts.push(`**Positive Correlations (${positive.length}):**`);
    for (const cs of positive.slice(0, 3)) {
      parts.push(`  - ${cs.leg1.player_name || cs.leg1.market} (${cs.leg1.side}) ↔ ${cs.leg2.player_name || cs.leg2.market} (${cs.leg2.side}): strength ${cs.strength.toFixed(2)}`);
    }
  }
  
  if (negative.length) {
    parts.push(`**Negative Correlations (${negative.length}):**`);
    for (const cs of negative.slice(0, 3)) {
      parts.push(`  - ${cs.leg1.player_name || cs.leg1.market} (${cs.leg1.side}) ↔ ${cs.leg2.player_name || cs.leg2.market} (${cs.leg2.side}): strength ${cs.strength.toFixed(2)}`);
    }
  }
  
  parts.push('');
  parts.push(`**Overall Assessment:** ${analysis.recommendation.toUpperCase()}`);
  parts.push(`  ${analysis.explanation}`);
  parts.push(`  Combined CLV multiplier: ${analysis.combinedClvMultiplier.toFixed(2)}x`);
  
  return parts.join('\n');
}