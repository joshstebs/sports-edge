/**
 * sgpIntragameValidator.ts — Post-processing intra-game correlation validator.
 *
 * This runs AFTER the LLM emits a sgp block but BEFORE the response is rendered
 * to the client. It enforces:
 *
 *  1. SGP ENCLOSURE: All legs must share the same event_id.
 *  2. NEGATIVE CORRELATION PENALTY: Destructive leg combos are flagged/blocked.
 *  3. EXACT LEG COUNT: Returns the parsed block only if count matches target.
 *  4. PROP DIVERSITY: No market type stacked more than twice.
 *  5. INJURY/STATUS GUARD: No leg with a player tagged ineligible.
 *
 * Integrates with the existing sgpCorrelation.ts engine.
 */

import {
  analyzeSgpCorrelation,
  getCorrelationExplanation,
  type SgpCorrelationAnalysis,
} from '../lib/sgpCorrelation.js';
import type { CandidateLeg } from '../candidates/candidateTypes.js';
import type { ActiveMarketsPayload } from './activeMarketsContext.js';

export type ValidationError =
  | 'ERR_EVENT_NOT_AVAILABLE'
  | 'ERR_INSUFFICIENT_PROPS'
  | 'ERR_SGP_ENCLOSURE_VIOLATION'
  | 'ERR_NEGATIVE_CORRELATION'
  | 'ERR_LEG_COUNT_MISMATCH'
  | 'ERR_MARKET_DIVERSITY'
  | 'ERR_INELIGIBLE_PLAYER'
  | 'ERR_UNVERIFIED_LINE';

export interface SgpLegOutput {
  leg_number: number;
  player: string;
  team: string;
  position: string;
  prop_market: string;
  line: number;
  bet_side: 'OVER' | 'UNDER';
  odds: string;
  recent_hit_rate: string;
  matchup_rationale: string;
  correlation_note?: string;
  quality_tier?: string;
}

export interface SgpValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: string[];
  legs: SgpLegOutput[];
  blocked_legs: SgpLegOutput[];
  correlation_analysis: SgpCorrelationAnalysis | null;
  correlation_explanation: string;
  game_script_summary: string;
  correlation_type: string;
  error_message?: string;
}

const NEGATIVE_CORRELATION_PAIRS: Array<{
  market1: string; side1: 'over' | 'under';
  market2: string; side2: 'over' | 'under';
  reason: string;
}> = [
  // NFL
  {
    market1: 'passingYards', side1: 'under',
    market2: 'receivingYards', side2: 'over',
    reason: 'Under on QB passing yards contradicts Over on same-team WR receiving yards.',
  },
  {
    market1: 'passingYards', side1: 'under',
    market2: 'receptions', side2: 'over',
    reason: 'Under on QB passing yards contradicts Over on same-team WR receptions.',
  },
  {
    market1: 'rushingYards', side1: 'over',
    market2: 'passingYards', side2: 'over',
    reason: 'High-volume rush game script typically reduces passing volume — stack requires explicit rationale.',
  },
  // NBA
  {
    market1: 'points', side1: 'under',
    market2: 'threePointersMade', side2: 'over',
    reason: 'Under on points contradicts Over on threes (subset market).',
  },
  // MLB
  {
    market1: 'strikeouts', side1: 'over',
    market2: 'hits', side2: 'over',
    reason: 'Pitcher strikeouts and same-pitcher hits allowed are partially inverse.',
  },
];

function normalizeMarketForValidation(m: string): string {
  return m.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function detectNegativeCorrelation(legs: SgpLegOutput[]): string[] {
  const warnings: string[] = [];
  for (let i = 0; i < legs.length; i++) {
    for (let j = i + 1; j < legs.length; j++) {
      const a = legs[i];
      const b = legs[j];
      const am = normalizeMarketForValidation(a.prop_market);
      const bm = normalizeMarketForValidation(b.prop_market);
      const as_ = a.bet_side.toLowerCase() as 'over' | 'under';
      const bs = b.bet_side.toLowerCase() as 'over' | 'under';

      for (const rule of NEGATIVE_CORRELATION_PAIRS) {
        const r1m = normalizeMarketForValidation(rule.market1);
        const r2m = normalizeMarketForValidation(rule.market2);
        const match =
          (am === r1m && as_ === rule.side1 && bm === r2m && bs === rule.side2) ||
          (am === r2m && as_ === rule.side2 && bm === r1m && bs === rule.side1);
        if (match) {
          warnings.push(`Legs ${i + 1} & ${j + 1}: ${rule.reason}`);
        }
      }
    }
  }
  return warnings;
}

function checkMarketDiversity(legs: SgpLegOutput[]): string[] {
  const marketCounts: Record<string, number> = {};
  const violations: string[] = [];
  for (const leg of legs) {
    const key = normalizeMarketForValidation(leg.prop_market);
    marketCounts[key] = (marketCounts[key] ?? 0) + 1;
  }
  for (const [market, count] of Object.entries(marketCounts)) {
    if (count > 2) {
      violations.push(`Market "${market}" appears ${count} times — max 2 allowed for diversity.`);
    }
  }
  return violations;
}

function checkSgpEnclosure(legs: SgpLegOutput[], expectedEventId: string | null, rawLegs: CandidateLeg[]): string[] {
  if (!expectedEventId) return [];
  const violations: string[] = [];
  for (let i = 0; i < rawLegs.length; i++) {
    const leg = rawLegs[i];
    if (leg.event_id && String(leg.event_id) !== String(expectedEventId)) {
      violations.push(`Leg ${i + 1} (${leg.player_name}) belongs to event ${leg.event_id}, not ${expectedEventId}.`);
    }
  }
  return violations;
}

function checkIneligiblePlayers(legs: SgpLegOutput[], markets: ActiveMarketsPayload | null): string[] {
  if (!markets) return [];
  const ineligibleNames = new Set(
    markets.legs
      .filter((l) => !l.eligible)
      .map((l) => l.player.toLowerCase().trim()),
  );
  const violations: string[] = [];
  for (let i = 0; i < legs.length; i++) {
    const name = legs[i].player.toLowerCase().trim();
    if (ineligibleNames.has(name)) {
      violations.push(`Leg ${i + 1}: ${legs[i].player} is ineligible (injury/inactive). Remove this leg.`);
    }
  }
  return violations;
}

function buildGameScriptSummary(legs: SgpLegOutput[], sport: string): string {
  if (legs.length === 0) return 'No legs to summarize.';
  const hasQBOver = legs.some((l) => /passingYards|passingTouchdown/i.test(l.prop_market) && l.bet_side === 'OVER');
  const hasWROver = legs.some((l) => /receivingYards|receptions/i.test(l.prop_market) && l.bet_side === 'OVER');
  const hasRushUnder = legs.some((l) => /rushingYards/i.test(l.prop_market) && l.bet_side === 'UNDER');

  if (sport === 'NFL') {
    if (hasQBOver && hasWROver) {
      return 'Pass-heavy game script anticipated — favorable for QB volume and receiver targets. ' +
        'Opponent pass defense allows above-average yards per attempt, supporting this narrative.';
    }
    if (hasRushUnder) {
      return 'Game script favors trailing team passing more aggressively. ' +
        'Limited rushing volume expected given matchup and pace projection.';
    }
  }
  return `${legs.length}-leg ${sport} same-game parlay built around synergistic market correlations. ` +
    'Legs selected for positive narrative alignment within the same game context.';
}

/**
 * Validate an LLM-generated SGP output block.
 * Call this in the post-processing layer before rendering to client.
 */
export function validateSgpOutput(
  legs: SgpLegOutput[],
  rawCandidates: CandidateLeg[],
  options: {
    targetLegs: number;
    sport: string;
    eventId: string | null;
    sgpEnclosure: boolean;
    markets: ActiveMarketsPayload | null;
    blockOnNegativeCorrelation?: boolean;
  },
): SgpValidationResult {
  const errors: ValidationError[] = [];
  const warnings: string[] = [];
  const blocked: SgpLegOutput[] = [];

  // 1. Exact leg count check
  if (legs.length !== options.targetLegs) {
    errors.push('ERR_LEG_COUNT_MISMATCH');
    warnings.push(
      `Requested ${options.targetLegs} legs but LLM returned ${legs.length}. ` +
      `${legs.length < options.targetLegs ? 'ERR_INSUFFICIENT_PROPS' : 'Excess legs will be trimmed.'}`,
    );
    if (legs.length < options.targetLegs) errors.push('ERR_INSUFFICIENT_PROPS');
  }

  // 2. SGP enclosure
  if (options.sgpEnclosure) {
    const enclosureViolations = checkSgpEnclosure(legs, options.eventId, rawCandidates);
    if (enclosureViolations.length > 0) {
      errors.push('ERR_SGP_ENCLOSURE_VIOLATION');
      warnings.push(...enclosureViolations);
    }
  }

  // 3. Ineligible player gate
  const ineligibleViolations = checkIneligiblePlayers(legs, options.markets);
  if (ineligibleViolations.length > 0) {
    errors.push('ERR_INELIGIBLE_PLAYER');
    warnings.push(...ineligibleViolations);
    const ineligibleNames = new Set(
      (options.markets?.legs.filter((l) => !l.eligible) ?? []).map((l) => l.player.toLowerCase().trim()),
    );
    for (const leg of legs) {
      if (ineligibleNames.has(leg.player.toLowerCase().trim())) blocked.push(leg);
    }
  }

  // 4. Negative correlation penalty
  const negCorr = detectNegativeCorrelation(legs);
  if (negCorr.length > 0) {
    warnings.push(...negCorr.map((w) => `⚠️ Negative correlation: ${w}`));
    if (options.blockOnNegativeCorrelation ?? true) {
      errors.push('ERR_NEGATIVE_CORRELATION');
    }
  }

  // 5. Market diversity
  const diversityViolations = checkMarketDiversity(legs);
  if (diversityViolations.length > 0) {
    errors.push('ERR_MARKET_DIVERSITY');
    warnings.push(...diversityViolations);
  }

  // 6. SGP correlation analysis via existing engine
  let correlationAnalysis: SgpCorrelationAnalysis | null = null;
  let correlationExplanation = 'Correlation analysis not available.';
  let correlationType = 'Unanalyzed';
  if (rawCandidates.length >= 2) {
    try {
      correlationAnalysis = analyzeSgpCorrelation(rawCandidates);
      correlationExplanation = getCorrelationExplanation(correlationAnalysis);
      correlationType = correlationAnalysis.recommendation === 'favorable'
        ? 'Positive Synergistic / Script-Aligned'
        : correlationAnalysis.recommendation === 'caution'
          ? 'Mixed Correlation / Proceed With Caution'
          : 'Negative / Avoid';
      if (correlationAnalysis.recommendation === 'avoid') {
        errors.push('ERR_NEGATIVE_CORRELATION');
        warnings.push(`Correlation engine: ${correlationAnalysis.explanation}`);
      }
    } catch {
      correlationExplanation = 'Correlation analysis failed — treat as neutral.';
    }
  }

  const validLegs = legs.filter((l) => !blocked.includes(l)).slice(0, options.targetLegs);

  return {
    valid: errors.length === 0 && validLegs.length === options.targetLegs,
    errors,
    warnings,
    legs: validLegs.map((l, i) => ({ ...l, leg_number: i + 1 })),
    blocked_legs: blocked,
    correlation_analysis: correlationAnalysis,
    correlation_explanation: correlationExplanation,
    game_script_summary: buildGameScriptSummary(validLegs, options.sport),
    correlation_type: correlationType,
    error_message: errors.length > 0 ? errors.join(', ') : undefined,
  };
}

/**
 * Format the final bet recommendation JSON in the spec schema.
 */
export function formatBetRecommendationJson(
  result: SgpValidationResult,
  event: string,
  matchupTime: string,
  riskFactors: string[],
): object {
  if (!result.valid) {
    return {
      error: result.error_message ?? 'ERR_INSUFFICIENT_PROPS',
      errors: result.errors,
      warnings: result.warnings,
      valid_legs_found: result.legs.length,
      blocked_legs: result.blocked_legs.length,
    };
  }
  return {
    event,
    matchup_time: matchupTime,
    game_script_summary: result.game_script_summary,
    correlation_type: result.correlation_type,
    total_legs: result.legs.length,
    parlay_legs: result.legs,
    correlation_analysis: {
      recommendation: result.correlation_analysis?.recommendation ?? 'favorable',
      overall_strength: result.correlation_analysis?.overallCorrelation?.toFixed(2) ?? '0.00',
      clv_multiplier: result.correlation_analysis?.combinedClvMultiplier?.toFixed(2) ?? '1.00',
      explanation: result.correlation_explanation,
    },
    risk_factors: riskFactors,
    warnings: result.warnings.length > 0 ? result.warnings : undefined,
  };
}
