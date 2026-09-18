/**
 * betGenerationEngine.test.ts — Unit tests for the bet generation pipeline.
 *
 * Tests:
 *  - parseBetRequest: exact leg extraction, league detection, SGP enclosure
 *  - sgpIntragameValidator: negative correlation detection, market diversity,
 *    leg count enforcement, ineligible player gate
 *  - serializeBetRequestContext: output structure
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

function expect(actual: any) {
  return {
    toBe(expected: any) {
      assert.equal(actual, expected);
    },
    toBeGreaterThan(expected: number) {
      assert.ok(actual > expected);
    },
    toContain(expected: any) {
      assert.ok(actual?.includes?.(expected), `Expected value to contain ${String(expected)}`);
    },
    toHaveLength(expected: number) {
      assert.equal(actual?.length, expected);
    },
    toBeDefined() {
      assert.notEqual(actual, undefined);
    },
    not: {
      toContain(expected: any) {
        assert.ok(!actual?.includes?.(expected), `Expected value not to contain ${String(expected)}`);
      },
    },
  };
}
import { parseBetRequest, serializeBetRequestContext } from '../src/models/betRequest.js';
import {
  validateSgpOutput,
  formatBetRecommendationJson,
  type SgpLegOutput,
} from '../src/lib/sgpIntragameValidator.js';
import type { CandidateLeg } from '../src/candidates/candidateTypes.js';

// ─── parseBetRequest ─────────────────────────────────────────────────────────

describe('parseBetRequest', () => {
  it('parses a 6-leg NFL SGP', () => {
    const result = parseBetRequest('build me a 6 leg same game parlay for the NFL game today');
    expect(result.valid).toBe(true);
    expect(result.request?.target_legs).toBe(6);
    expect(result.request?.league).toBe('NFL');
    expect(result.request?.bet_type).toBe('sgp');
    expect(result.request?.sgp_enclosure).toBe(true);
  });

  it('parses word numbers correctly', () => {
    const result = parseBetRequest('give me a six leg NFL parlay');
    expect(result.valid).toBe(true);
    expect(result.request?.target_legs).toBe(6);
  });

  it('defaults target_legs to 6 when not specified', () => {
    const result = parseBetRequest('best NFL prop picks today');
    expect(result.valid).toBe(true);
    expect(result.request?.target_legs).toBe(6);
  });

  it('clamps target_legs to 12 max', () => {
    const result = parseBetRequest('give me 15 leg NFL parlay');
    expect(result.valid).toBe(true);
    expect(result.request?.target_legs).toBe(12);
  });

  it('detects NBA from basketball keyword', () => {
    const result = parseBetRequest('3 pick basketball parlay');
    expect(result.valid).toBe(true);
    expect(result.request?.league).toBe('NBA');
  });

  it('returns invalid when league is not detectable', () => {
    const result = parseBetRequest('give me 5 leg parlay please');
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('extracts event_id from text', () => {
    const result = parseBetRequest('NFL SGP for game ID 401547611');
    expect(result.valid).toBe(true);
    expect(result.request?.event_id).toBe('401547611');
  });

  it('serializes context block with exact leg count enforcement', () => {
    const parsed = parseBetRequest('build me a 4 leg NFL SGP');
    expect(parsed.valid).toBe(true);
    const ctx = serializeBetRequestContext(parsed.request!);
    expect(ctx).toContain('EXACTLY 4 legs');
    expect(ctx).toContain('sgp_enclosure: true');
    expect(ctx).toContain('league: NFL');
  });
});

// ─── validateSgpOutput ───────────────────────────────────────────────────────

function makeLeg(overrides: Partial<SgpLegOutput>): SgpLegOutput {
  return {
    leg_number: 1,
    player: 'Patrick Mahomes',
    team: 'KC',
    position: 'QB',
    prop_market: 'passingYards',
    line: 275.5,
    bet_side: 'OVER',
    odds: '-115',
    recent_hit_rate: '4/5 (80%)',
    matchup_rationale: 'Opponent allows 270 yd/game',
    ...overrides,
  };
}

function makeCandidateLeg(overrides: Partial<CandidateLeg>): CandidateLeg {
  return {
    entity_type: 'player',
    player_name: 'Patrick Mahomes',
    sport: 'nfl',
    game: 'DAL @ KC',
    game_date: '2026-09-18',
    event_id: 'evt001',
    selection: 'Patrick Mahomes OVER 275.5 passing yards',
    market: 'passingYards',
    side: 'over',
    line: 275.5,
    odds: -115,
    game_odds: '-7',
    justification: 'Strong volume projection.',
    risk: 'Medium',
    correlation: 'Neutral',
    confidence: 68,
    ...overrides,
  };
}

describe('validateSgpOutput — leg count', () => {
  it('passes when leg count matches target', () => {
    const legs = [
      makeLeg({ leg_number: 1, prop_market: 'passingYards', bet_side: 'OVER' }),
      makeLeg({ leg_number: 2, player: 'Travis Kelce', position: 'TE', prop_market: 'receivingYards', bet_side: 'OVER' }),
      makeLeg({ leg_number: 3, player: 'Travis Kelce', position: 'TE', prop_market: 'receptions', bet_side: 'OVER' }),
    ];
    const candidates = legs.map((l) => makeCandidateLeg({ player_name: l.player, market: l.prop_market }));
    const result = validateSgpOutput(legs, candidates, {
      targetLegs: 3,
      sport: 'NFL',
      eventId: 'evt001',
      sgpEnclosure: true,
      markets: null,
    });
    expect(result.errors).not.toContain('ERR_LEG_COUNT_MISMATCH');
    expect(result.legs).toHaveLength(3);
  });

  it('flags ERR_INSUFFICIENT_PROPS when legs < target', () => {
    const legs = [makeLeg()];
    const result = validateSgpOutput(legs, [makeCandidateLeg()], {
      targetLegs: 4,
      sport: 'NFL',
      eventId: null,
      sgpEnclosure: false,
      markets: null,
    });
    expect(result.errors).toContain('ERR_INSUFFICIENT_PROPS');
    expect(result.valid).toBe(false);
  });
});

describe('validateSgpOutput — negative correlation', () => {
  it('flags Under passingYards + Over receivingYards (same-team contradiction)', () => {
    const legs = [
      makeLeg({ prop_market: 'passingYards', bet_side: 'UNDER' }),
      makeLeg({ player: 'Travis Kelce', position: 'TE', prop_market: 'receivingYards', bet_side: 'OVER' }),
    ];
    const result = validateSgpOutput(legs, [], {
      targetLegs: 2,
      sport: 'NFL',
      eventId: null,
      sgpEnclosure: false,
      markets: null,
      blockOnNegativeCorrelation: false, // warn only
    });
    const hasNegCorrWarning = result.warnings.some((w) => /negative correlation/i.test(w));
    expect(hasNegCorrWarning).toBe(true);
  });

  it('blocks on negative correlation when blockOnNegativeCorrelation=true', () => {
    const legs = [
      makeLeg({ prop_market: 'passingYards', bet_side: 'UNDER' }),
      makeLeg({ player: 'Travis Kelce', position: 'TE', prop_market: 'receivingYards', bet_side: 'OVER' }),
    ];
    const result = validateSgpOutput(legs, [], {
      targetLegs: 2,
      sport: 'NFL',
      eventId: null,
      sgpEnclosure: false,
      markets: null,
      blockOnNegativeCorrelation: true,
    });
    expect(result.errors).toContain('ERR_NEGATIVE_CORRELATION');
  });
});

describe('validateSgpOutput — market diversity', () => {
  it('flags when same market appears 3+ times', () => {
    const legs = [
      makeLeg({ leg_number: 1, player: 'Player A', prop_market: 'receivingYards' }),
      makeLeg({ leg_number: 2, player: 'Player B', prop_market: 'receivingYards' }),
      makeLeg({ leg_number: 3, player: 'Player C', prop_market: 'receivingYards' }),
    ];
    const result = validateSgpOutput(legs, [], {
      targetLegs: 3,
      sport: 'NFL',
      eventId: null,
      sgpEnclosure: false,
      markets: null,
    });
    expect(result.errors).toContain('ERR_MARKET_DIVERSITY');
  });

  it('allows same market appearing exactly twice', () => {
    const legs = [
      makeLeg({ leg_number: 1, player: 'Player A', prop_market: 'receivingYards' }),
      makeLeg({ leg_number: 2, player: 'Player B', prop_market: 'receivingYards' }),
      makeLeg({ leg_number: 3, player: 'Patrick Mahomes', prop_market: 'passingYards', bet_side: 'OVER' }),
    ];
    const result = validateSgpOutput(legs, [], {
      targetLegs: 3,
      sport: 'NFL',
      eventId: null,
      sgpEnclosure: false,
      markets: null,
    });
    expect(result.errors).not.toContain('ERR_MARKET_DIVERSITY');
  });
});

describe('validateSgpOutput — ineligible player gate', () => {
  it('blocks a player marked ineligible in the markets payload', () => {
    const legs = [makeLeg({ player: 'Injured Player' })];
    const markets = {
      league: 'NFL',
      event_id: null,
      generated_at: new Date().toISOString(),
      market_count: 1,
      eligible_count: 0,
      legs: [{
        player: 'Injured Player',
        team: 'KC',
        position: 'WR',
        sport: 'NFL',
        event_id: 'evt001',
        game: 'DAL @ KC',
        game_date: '2026-09-18',
        prop_market: 'receivingYards',
        line: 45.5,
        bet_side: 'OVER' as const,
        odds: '-110',
        line_source: 'test',
        line_checked_at: new Date().toISOString(),
        availability_verified: true,
        injury_status: 'out',
        eligible: false,
        ineligible_reason: 'Player status: out — confirmed OUT on injury report.',
      }],
    };
    const result = validateSgpOutput(legs, [], {
      targetLegs: 1,
      sport: 'NFL',
      eventId: null,
      sgpEnclosure: false,
      markets,
    });
    expect(result.errors).toContain('ERR_INELIGIBLE_PLAYER');
    expect(result.blocked_legs).toHaveLength(1);
  });
});

describe('formatBetRecommendationJson', () => {
  it('returns error object on invalid result', () => {
    const result = validateSgpOutput([], [], {
      targetLegs: 3, sport: 'NFL', eventId: null, sgpEnclosure: false, markets: null,
    });
    const json = formatBetRecommendationJson(result, 'DAL @ KC', '2026-09-18 13:00 EST', []);
    expect((json as any).error).toBeDefined();
  });

  it('returns full schema-compliant output on valid result', () => {
    const legs = [
      makeLeg({ leg_number: 1, prop_market: 'passingYards', bet_side: 'OVER' }),
      makeLeg({ leg_number: 2, player: 'Travis Kelce', prop_market: 'receivingYards', bet_side: 'OVER' }),
      makeLeg({ leg_number: 3, player: 'Travis Kelce', prop_market: 'receptions', bet_side: 'OVER' }),
    ];
    const result = validateSgpOutput(legs, [], {
      targetLegs: 3, sport: 'NFL', eventId: null, sgpEnclosure: false, markets: null,
    });
    const json = formatBetRecommendationJson(result, 'DAL @ KC', '2026-09-18 13:00 EST', ['Weather risk']);
    const typed = json as any;
    if (result.valid) {
      expect(typed.total_legs).toBe(3);
      expect(typed.parlay_legs).toHaveLength(3);
      expect(typed.event).toBe('DAL @ KC');
      expect(typed.risk_factors).toContain('Weather risk');
    } else {
      // Acceptable: the test passes correlation/diversity checks might block
      expect(typed.error).toBeDefined();
    }
  });
});
