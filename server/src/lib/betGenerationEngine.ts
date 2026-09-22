/**
 * betGenerationEngine.ts — End-to-end bet generation pipeline.
 *
 * Pipeline stages (runs entirely server-side before LLM invocation):
 *
 *  Stage 1: parseBetRequest()         — Extract & validate BetRequest schema
 *  Stage 2: buildActiveMarketsContext() — Pre-fetch live odds + injury gates
 *  Stage 3: serializeBetRequestContext() + serializeActiveMarketsContext()
 *             — Inject ACTIVE_BET_REQUEST + ACTIVE_MARKETS into LLM context
 *  Stage 4: LLM generates sgp block   (handled by chatClient / tools pipeline)
 *  Stage 5: validateSgpOutput()       — Post-process: correlation check,
 *             leg count, enclosure, diversity, ineligible player gate
 *  Stage 6: formatBetRecommendationJson() — Emit structured spec-schema JSON
 *
 * This module exposes the pipeline orchestrator that routes a user message
 * through all stages, returning either a validated bet slip or error codes.
 */

import { parseBetRequest, serializeBetRequestContext, type BetRequest } from '../models/betRequest.js';
import { buildActiveMarketsContext, serializeActiveMarketsContext, type ActiveMarketsPayload } from '../models/activeMarketsContext.js';
import { validateSgpOutput, formatBetRecommendationJson, type SgpLegOutput } from './sgpIntragameValidator.js';
import type { CandidateLeg } from '../candidates/candidateTypes.js';

export interface BetGenerationContext {
  /** Injected into LLM system/user context window before generation */
  betRequestContext: string;
  /** Injected into LLM system/user context window before generation */
  activeMarketsContext: string;
  /** Combined prompt prefix — pass to chatClient as additional context */
  fullContextBlock: string;
  /** Parsed, validated request */
  request: BetRequest;
  /** Active markets payload for post-processing validator */
  markets: ActiveMarketsPayload;
}

export interface BetGenerationResult {
  valid: boolean;
  context: BetGenerationContext | null;
  outputJson: object;
  errorCode: string | null;
  errors: string[];
  warnings: string[];
}

/**
 * Stage 1–3: Build the LLM context for a bet generation request.
 * Call this BEFORE invoking the LLM. Inject `context.fullContextBlock`
 * into the prompt.
 */
export async function buildBetGenerationContext(
  userMessage: string,
  candidates: Array<{
    player: string;
    team: string;
    position: string;
    event_id: string;
    game: string;
    game_date: string;
    prop_market: string;
    line: number;
    bet_side: 'OVER' | 'UNDER';
    odds: string | null;
    line_checked_at?: string | null;
  }>,
): Promise<{ context: BetGenerationContext | null; errors: string[]; errorCode: string | null }> {
  // Stage 1: Parse & validate the BetRequest
  const parsed = parseBetRequest(userMessage);
  if (!parsed.valid || !parsed.request) {
    return { context: null, errors: parsed.errors, errorCode: parsed.errorCode ?? 'ERR_INVALID_REQUEST' };
  }

  // Stage 2: Build active markets context (pre-fetches availability)
  const markets = await buildActiveMarketsContext(parsed.request, candidates);

  if (markets.eligible_count === 0) {
    return {
      context: null,
      errors: ['No eligible verified markets found for this request.'],
      errorCode: 'ERR_INSUFFICIENT_PROPS',
    };
  }

  // Stage 3: Serialize context blocks for prompt injection
  const betRequestContext = serializeBetRequestContext(parsed.request);
  const activeMarketsContext = serializeActiveMarketsContext(markets);
  const fullContextBlock = [betRequestContext, '', activeMarketsContext].join('\n');

  return {
    context: {
      betRequestContext,
      activeMarketsContext,
      fullContextBlock,
      request: parsed.request,
      markets,
    },
    errors: [],
    errorCode: null,
  };
}

/**
 * Stage 5–6: Post-process LLM output through the validation and formatting pipeline.
 * Call this AFTER the LLM returns a sgp block.
 */
export function postProcessBetOutput(
  llmLegs: SgpLegOutput[],
  rawCandidates: CandidateLeg[],
  context: BetGenerationContext,
  meta: {
    event: string;
    matchupTime: string;
    riskFactors?: string[];
  },
): BetGenerationResult {
  const result = validateSgpOutput(llmLegs, rawCandidates, {
    targetLegs: context.request.target_legs,
    sport: context.request.league,
    eventId: context.request.event_id,
    sgpEnclosure: context.request.sgp_enclosure,
    markets: context.markets,
    blockOnNegativeCorrelation: true,
  });

  const outputJson = formatBetRecommendationJson(
    result,
    meta.event,
    meta.matchupTime,
    meta.riskFactors ?? [
      'Injury at game time — check final injury report before placing bet.',
      'Weather conditions may affect game script for outdoor venues.',
      'Line movement after context snapshot — verify odds before bet placement.',
    ],
  );

  return {
    valid: result.valid,
    context,
    outputJson,
    errorCode: result.error_message ?? null,
    errors: result.errors,
    warnings: result.warnings,
  };
}

/**
 * Convenience: full pipeline for API route handlers.
 * Calls Stage 1–3 (context build), then expects the caller to invoke the LLM
 * with `context.fullContextBlock`, then call postProcessBetOutput with the result.
 *
 * Usage in chat.ts route:
 *
 *   const { context, errors } = await buildBetGenerationContext(userMsg, candidates);
 *   if (!context) return res.json({ error: errors[0] });
 *
 *   // Inject context.fullContextBlock into LLM prompt...
 *   const llmLegs = parseSgpBlockFromLlmResponse(llmOutput);
 *
 *   const result = postProcessBetOutput(llmLegs, rawCandidates, context, { event, matchupTime });
 *   return res.json(result.outputJson);
 */
export { parseBetRequest, serializeBetRequestContext } from '../models/betRequest.js';
export { validateSgpOutput, formatBetRecommendationJson } from './sgpIntragameValidator.js';
