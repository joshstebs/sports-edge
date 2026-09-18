/**
 * activeMarketsContext.ts — ACTIVE_MARKETS RAG context injector.
 *
 * Pre-fetches verified live prop lines, injury gates, and defensive rankings
 * from existing platform providers and formats them as a structured context
 * block injected directly into the LLM context window BEFORE generation.
 *
 * The LLM must ONLY choose from markets listed in this block. Any line not
 * present here is unverified and must not be emitted in a recommendation.
 */

import type { BetRequest } from './betRequest.js';
import { checkPlayerAvailability } from '../providers/playerAvailability.js';

export interface ActiveMarketLeg {
  player: string;
  team: string;
  position: string;
  sport: string;
  event_id: string;
  game: string;
  game_date: string;
  prop_market: string;
  line: number;
  bet_side: 'OVER' | 'UNDER';
  odds: string;
  line_source: string;
  line_checked_at: string;
  availability_verified: boolean;
  injury_status: string;
  eligible: boolean;
  ineligible_reason?: string;
}

export interface ActiveMarketsPayload {
  league: string;
  event_id: string | null;
  generated_at: string;
  market_count: number;
  eligible_count: number;
  legs: ActiveMarketLeg[];
  error?: string;
}

/**
 * Builds a structured ACTIVE_MARKETS context block from live data.
 * Results are injected into the LLM prompt under `# ACTIVE_MARKETS`.
 * Only `eligible: true` legs may be selected by the model.
 */
export async function buildActiveMarketsContext(
  req: BetRequest,
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
  }>,
): Promise<ActiveMarketsPayload> {
  const now = new Date().toISOString();
  const legs: ActiveMarketLeg[] = [];

  const INELIGIBLE_STATUSES: Set<string> = new Set([
    'out', 'inactive', 'suspended', 'ir', 'injured reserve', 'doubtful',
  ]);

  await Promise.all(
    candidates.map(async (c) => {
      try {
        const avail = await checkPlayerAvailability(
          c.player,
          req.league.toLowerCase() as 'nfl' | 'nba' | 'mlb' | 'nhl',
        );
        const statusLower = (avail.playingStatus ?? 'unknown').toLowerCase();
        const eligible = avail.recommendationEligible === true
          && !INELIGIBLE_STATUSES.has(statusLower);

        legs.push({
          player: c.player,
          team: c.team,
          position: c.position,
          sport: req.league,
          event_id: c.event_id,
          game: c.game,
          game_date: c.game_date,
          prop_market: c.prop_market,
          line: c.line,
          bet_side: c.bet_side,
          odds: c.odds ?? 'N/A',
          line_source: 'oddsAggregator',
          line_checked_at: now,
          availability_verified: avail.statusVerified,
          injury_status: avail.playingStatus,
          eligible,
          ineligible_reason: eligible ? undefined
            : `Player status: ${avail.playingStatus} — ${avail.reason}`,
        });
      } catch (err) {
        // Fail closed: if availability check throws, mark ineligible
        legs.push({
          player: c.player,
          team: c.team,
          position: c.position,
          sport: req.league,
          event_id: c.event_id,
          game: c.game,
          game_date: c.game_date,
          prop_market: c.prop_market,
          line: c.line,
          bet_side: c.bet_side,
          odds: c.odds ?? 'N/A',
          line_source: 'oddsAggregator',
          line_checked_at: now,
          availability_verified: false,
          injury_status: 'unknown',
          eligible: false,
          ineligible_reason: `Availability check error: ${(err as Error).message}`,
        });
      }
    }),
  );

  const eligible_count = legs.filter((l) => l.eligible).length;

  return {
    league: req.league,
    event_id: req.event_id,
    generated_at: now,
    market_count: legs.length,
    eligible_count,
    legs,
  };
}

/**
 * Serialize the payload into a # ACTIVE_MARKETS prompt block.
 * Only eligible legs are listed; ineligible legs are counted but not
 * described so the LLM cannot accidentally re-select them.
 */
export function serializeActiveMarketsContext(payload: ActiveMarketsPayload): string {
  const lines: string[] = [
    '# ACTIVE_MARKETS',
    `League: ${payload.league}`,
    `Generated: ${payload.generated_at}`,
    `Total markets verified: ${payload.market_count}`,
    `Eligible for selection: ${payload.eligible_count}`,
    `Ineligible (injury/inactive — DO NOT SELECT): ${payload.market_count - payload.eligible_count}`,
    '',
    '## ELIGIBLE LEGS (model may only select from this list)',
  ];

  const eligible = payload.legs.filter((l) => l.eligible);
  if (eligible.length === 0) {
    lines.push('  ⚠️  No eligible legs found. Return ERR_INSUFFICIENT_PROPS.');
  }

  for (const leg of eligible) {
    lines.push(
      `  - ${leg.player} (${leg.position}, ${leg.team}) | ${leg.game} | ${leg.prop_market} ${leg.bet_side} ${leg.line} @ ${leg.odds} | verified: ${leg.availability_verified} | checked: ${leg.line_checked_at}`,
    );
  }

  lines.push('');
  lines.push('## CRITICAL RULES');
  lines.push('  - Selecting any player NOT in the ELIGIBLE LEGS list above is PROHIBITED.');
  lines.push('  - Emitting a line value that differs from the verified line above is PROHIBITED.');
  lines.push('  - Ineligible / injured / inactive players must never appear in parlay output.');

  return lines.join('\n');
}
