/**
 * betRequest.ts — Deterministic BetRequest schema extractor & validator.
 *
 * Mirrors the Python Pydantic model spec from the prompt:
 *   class BetRequest(BaseModel):
 *     bet_type: Literal["straight", "parlay", "sgp"]
 *     target_legs: conint(ge=1, le=12) = 6
 *     league: Literal["NFL", "NBA", "MLB", "NHL"]
 *     event_id: Optional[str]
 *
 * This runs BEFORE the LLM is invoked — it extracts constraints deterministically
 * from the user message so the model only chooses from a valid, bounded context.
 */

export type BetType = 'straight' | 'parlay' | 'sgp';
export type BetLeague = 'NFL' | 'NBA' | 'MLB' | 'NHL';

export interface BetRequest {
  bet_type: BetType;
  target_legs: number;          // 1–12, default 6
  league: BetLeague;
  event_id: string | null;      // optional specific game ID
  game_script_requested: boolean;
  sgp_enclosure: boolean;       // all legs must come from same event
}

export interface BetRequestValidation {
  valid: boolean;
  request: BetRequest | null;
  errors: string[];
  errorCode: 'ERR_EVENT_NOT_AVAILABLE' | 'ERR_INSUFFICIENT_PROPS' | null;
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12,
};

function extractLeagueFromText(text: string): BetLeague | null {
  const upper = text.toUpperCase();
  if (/\bNFL\b/.test(upper)) return 'NFL';
  if (/\bNBA\b/.test(upper)) return 'NBA';
  if (/\bMLB\b/.test(upper)) return 'MLB';
  if (/\bNHL\b/.test(upper)) return 'NHL';
  if (/\bfootball\b/i.test(text) && !/college|ncaa/i.test(text)) return 'NFL';
  if (/\bbasketball\b/i.test(text)) return 'NBA';
  if (/\bbaseball\b/i.test(text)) return 'MLB';
  if (/\bhockey\b/i.test(text)) return 'NHL';
  return null;
}

function extractBetType(text: string): BetType {
  const lower = text.toLowerCase();
  if (/\bstraight\b|\bsingle\b|\bmoneyline\b|\bml\b/.test(lower)) return 'straight';
  if (/\bsame[- ]?game\b|\bsgp\b/.test(lower)) return 'sgp';
  if (/\bparlay\b|\bprop\s+parlay\b|\bmulti[- ]?leg\b/.test(lower)) return 'parlay';
  return /\blegs?\b|\bpicks?\b/.test(lower) ? 'parlay' : 'straight';
}

function extractTargetLegs(text: string): number {
  const lower = text.toLowerCase().replace(
    /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/g,
    (w) => String(NUMBER_WORDS[w] ?? w),
  );
  const explicit = lower.match(/\b(\d{1,2})[- ]?(?:leg|legs|prop|props|pick|picks|game|games|way)\b/);
  if (explicit) {
    return Number(explicit[1]);
  }
  const generic = lower.match(/(?:build|give|want|make|create)(?:\s+me)?\s+(?:a\s+)?(\d{1,2})\b/);
  if (generic) {
    return Number(generic[1]);
  }
  return 6;
}

function extractEventId(text: string): string | null {
  const m = text.match(/(?:event[_ -]?id|game[_ -]?id|game\s+#|match\s+#)\s*[:#]?\s*([A-Za-z0-9_-]{4,20})/i);
  return m ? m[1] : null;
}

export function parseBetRequest(userMessage: string): BetRequestValidation {
  const errors: string[] = [];
  const text = String(userMessage ?? '');
  const league = extractLeagueFromText(text);
  if (!league) errors.push('Could not identify a supported league (NFL, NBA, MLB, NHL).');
  const bet_type = extractBetType(text);
  const target_legs = Math.max(1, Math.min(12, extractTargetLegs(text)));
  const event_id = extractEventId(text);
  const sgp_enclosure = bet_type === 'sgp' || /\bsame[- ]?game\b|\bsgp\b/i.test(text);
  const game_script_requested = /\bgame\s+script\b|\bnarrative\b|\bgame\s+flow\b/i.test(text);
  if (errors.length > 0) return { valid: false, request: null, errors, errorCode: null };
  return {
    valid: true, errors: [], errorCode: null,
    request: { bet_type, target_legs, league: league!, event_id, sgp_enclosure, game_script_requested },
  };
}

export function serializeBetRequestContext(req: BetRequest): string {
  return [
    '# ACTIVE_BET_REQUEST',
    `bet_type: ${req.bet_type}`,
    `target_legs: ${req.target_legs} — EXACTLY ${req.target_legs} legs required.`,
    `league: ${req.league}`,
    req.event_id ? `event_id: ${req.event_id}` : 'event_id: null (screener discovers slate)',
    `sgp_enclosure: ${req.sgp_enclosure}`,
    req.sgp_enclosure ? '  → ALL legs MUST originate from the SAME single event.' : '',
    `game_script_requested: ${req.game_script_requested}`,
    '',
    '## CONSTRAINT ENFORCEMENT',
    `- Return EXACTLY ${req.target_legs} legs. Emit ERR_INSUFFICIENT_PROPS if unavailable.`,
    `- NEVER invent a line. Every leg must have line_source and line_checked_at.`,
    `- NEVER select a player tagged OUT, IR, Inactive, Suspended, or Doubtful.`,
    `- Diversify prop_market: no more than 2 legs sharing the same market type.`,
    req.sgp_enclosure ? `- SGP: run intra-game correlation check before finalizing.` : '',
  ].filter(Boolean).join('\n');
}
