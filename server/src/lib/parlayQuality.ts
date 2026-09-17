import { propLineIntegrity } from '../models/propLineIntegrity.js';

export interface ParlayQualityPolicy {
  aggressive: boolean;
  sameGameIntent: boolean;
  minConfidence: number;
  supplementalMinConfidence: number;
  requestedMin: number | null;
  requestedMax: number | null;
  targetFill: boolean;
}

export interface QualityFilterResult<T = any> {
  legs: T[];
  blocked: T[];
  coreCount: number;
  supplementalCount: number;
}

function toConfidence(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(String(value).replace('%', '').trim());
  if (!Number.isFinite(parsed)) return null;
  const pct = parsed > 0 && parsed <= 1 ? parsed * 100 : parsed;
  return Math.max(0, Math.min(100, pct));
}

function eventKey(leg: Record<string, any>): string {
  const explicit = String(leg?.event_id ?? leg?.eventId ?? leg?.gamePk ?? '').trim();
  if (explicit) return explicit;
  const game = String(leg?.game ?? leg?.matchup ?? '').trim().toLowerCase();
  const date = String(leg?.game_date ?? leg?.gameDate ?? leg?.eventDate ?? '').slice(0, 10);
  return game ? `${game}|${date}` : '';
}

function qualitySource(leg: Record<string, any>): string {
  return String(
    leg?.quality_source ?? leg?.confidence_source ?? leg?.model_source ?? '',
  ).trim();
}

function isExplicitlyNegativeCorrelation(leg: Record<string, any>): boolean {
  return /\b(?:negative|conflict|opposes|anti[- ]?correlated)\b/i.test(String(leg?.correlation ?? ''));
}

export function parseParlayQualityPolicy(text: string): ParlayQualityPolicy {
  const numberWords: Record<string, string> = {
    one: '1', two: '2', three: '3', four: '4', five: '5',
    six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
  };
  const normalized = String(text ?? '').toLowerCase().replace(
    /\b(one|two|three|four|five|six|seven|eight|nine|ten)\b/g,
    (word) => numberWords[word],
  );
  const aggressive = /\b(?:aggressive|high[- ]?risk|long[- ]?shot|lottery|moonshot)\b/i.test(normalized);
  const sameGameIntent = /\b(?:same[- ]?game|sgp)\b/i.test(normalized);

  const range = normalized.match(/\b(\d{1,2})\s*(?:-|–|—|to)\s*(\d{1,2})\s*(?:leg|legs|game|games|pick|picks)?\b/i);
  const single = normalized.match(/\b(\d{1,2})\s*(?:-|–|—)?\s*(?:leg|legs|game|games|pick|picks)\b/i);
  let requestedMin: number | null = null;
  let requestedMax: number | null = null;
  if (range) {
    const a = Number(range[1]);
    const b = Number(range[2]);
    requestedMin = Math.min(a, b);
    requestedMax = Math.max(a, b);
  } else if (single) {
    requestedMin = requestedMax = Number(single[1]);
  }

  // When the user explicitly asks for a multi-pick construction, treat that
  // count as a real target. We still rank >=58% A/B candidates first, but may
  // use the strongest 54-57.9% C+ candidates to fill a remaining shortfall.
  // This restores useful 4-6 leg outputs without reopening the old low-quality
  // padding behavior. D-grade and sub-54% picks remain hard blocked.
  const targetFill = !aggressive && requestedMin != null && requestedMin >= 3;

  return {
    aggressive,
    sameGameIntent,
    minConfidence: aggressive ? 50 : 58,
    supplementalMinConfidence: aggressive ? 50 : 54,
    requestedMin,
    requestedMax,
    targetFill,
  };
}

function rankParlayCandidates<T extends Record<string, any>>(legs: T[], policy: ParlayQualityPolicy): T[] {
  const ranked = [...legs].sort((a, b) => {
    const aConfidence = toConfidence(a?.confidence ?? a?.model_probability) ?? 0;
    const bConfidence = toConfidence(b?.confidence ?? b?.model_probability) ?? 0;
    return bConfidence - aConfidence;
  });

  if (policy.sameGameIntent) {
    return policy.requestedMax != null ? ranked.slice(0, policy.requestedMax) : ranked;
  }

  const diverse: T[] = [];
  const deferred: T[] = [];
  const seenEvents = new Set<string>();
  for (const leg of ranked) {
    const key = eventKey(leg);
    if (key && seenEvents.has(key)) deferred.push(leg);
    else {
      diverse.push(leg);
      if (key) seenEvents.add(key);
    }
  }
  const output = [...diverse, ...deferred];
  return policy.requestedMax != null ? output.slice(0, policy.requestedMax) : output;
}

function passesNonConfidenceRules(leg: Record<string, any>, policy: ParlayQualityPolicy): boolean {
  const entityType = String(leg?.entity_type ?? '').toLowerCase();
  if ((entityType === 'team' || entityType === 'game') && !qualitySource(leg)) return false;
  if (!policy.aggressive && isExplicitlyNegativeCorrelation(leg)) return false;
  return true;
}

/**
 * Final server-side recommendation gate.
 * - D-grade / <50% legs are always rejected.
 * - Normal default recommendations require B-or-better (>=58%).
 * - If the user explicitly requests >=3 picks/legs, >=58% picks are selected
 *   first, then 54-57.9% C+ candidates may fill only the remaining shortfall.
 * - Supplemental C+ picks are tagged `quality_tier=supplemental` and are never
 *   promoted above core A/B picks.
 * - Aggressive requests may include C (>=50%) but never D (<50%).
 * - Missing confidence fails closed.
 * - Team/game markets still require attributable model/quality evidence.
 * - Explicit negative-correlation legs are rejected for normal parlays.
 */
export function filterParlayQuality<T extends Record<string, any>>(
  rawLegs: T[],
  policy: ParlayQualityPolicy,
): QualityFilterResult<T> {
  const core: T[] = [];
  const supplemental: T[] = [];
  const blocked: T[] = [];

  for (const leg of Array.isArray(rawLegs) ? rawLegs : []) {
    const confidence = toConfidence(leg?.confidence ?? leg?.model_probability);

    if (confidence == null || confidence < 50 || !passesNonConfidenceRules(leg, policy)) {
      blocked.push(leg);
      continue;
    }

    if (policy.aggressive || confidence >= policy.minConfidence) {
      core.push({ ...leg, quality_tier: policy.aggressive && confidence < 58 ? 'aggressive' : 'core' } as T);
      continue;
    }

    if (policy.targetFill && confidence >= policy.supplementalMinConfidence) {
      supplemental.push({
        ...leg,
        quality_tier: 'supplemental',
        quality_note: 'Supplemental target-fill pick: modeled below the normal 58% core threshold; lower-confidence than core selections.',
      } as T);
      continue;
    }

    blocked.push(leg);
  }

  const rankedCore = rankParlayCandidates(core, policy);
  if (policy.aggressive || !policy.targetFill || policy.requestedMin == null) {
    return { legs: rankedCore, blocked: [...blocked, ...supplemental], coreCount: rankedCore.length, supplementalCount: 0 };
  }

  const need = Math.max(0, policy.requestedMin - rankedCore.length);
  const rankedSupplemental = rankParlayCandidates(supplemental, {
    ...policy,
    requestedMax: need > 0 ? need : 0,
  });
  const selectedSupplemental = need > 0 ? rankedSupplemental.slice(0, need) : [];
  const selected = [...rankedCore, ...selectedSupplemental];
  const capped = policy.requestedMax != null ? selected.slice(0, policy.requestedMax) : selected;
  const selectedSupplementalKeys = new Set(selectedSupplemental.map((leg) => JSON.stringify(leg)));
  const unusedSupplemental = supplemental.filter((leg) => !selectedSupplementalKeys.has(JSON.stringify(leg)));

  return {
    legs: capped,
    blocked: [...blocked, ...unusedSupplemental],
    coreCount: capped.filter((leg: any) => leg?.quality_tier !== 'supplemental').length,
    supplementalCount: capped.filter((leg: any) => leg?.quality_tier === 'supplemental').length,
  };
}


export interface StructuredParlayResult<T = any> {
  legs: T[];
  qualified: T[];
  blocked: T[];
  lineBlocked: T[];
  complete: boolean;
  shortfall: number;
  requestedMin: number | null;
  requestedMax: number | null;
}

function normalizedSelection(leg: Record<string, any>): string {
  return String(leg?.selection ?? leg?.leg_name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9.+-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function structuredLegKey(leg: Record<string, any>): string {
  return [
    eventKey(leg),
    normalizedSelection(leg),
    String(leg?.market ?? '').toLowerCase(),
    String(leg?.side ?? '').toLowerCase(),
    String(leg?.line ?? leg?.target_line ?? ''),
  ].join('|');
}

function currentTimestamp(value: unknown, nowMs: number, maxAgeMs: number): boolean {
  const parsed = Date.parse(String(value ?? ''));
  return Number.isFinite(parsed) && parsed <= nowMs + 60_000 && nowMs - parsed <= maxAgeMs;
}

/**
 * A final structured leg must identify a real, recently checked market.
 * Model-only screening lines are intentionally not bettable.
 */
export function hasCurrentMarketLine(
  leg: Record<string, any>,
  nowMs = Date.now(),
  maxAgeMs = 15 * 60 * 1000,
): boolean {
  const entityType = String(leg?.entity_type ?? '').toLowerCase();
  if (leg?.provisional === true || leg?.line_verified === false) return false;
  const odds = Number(leg?.odds ?? leg?.implied_odds);
  const source = String(leg?.line_source ?? leg?.market_source ?? leg?.quality_source ?? '').trim();
  const checkedAt = leg?.line_checked_at ?? leg?.market_checked_at ?? leg?.checked_at;
  if (!Number.isFinite(odds) || odds === 0 || !source || !currentTimestamp(checkedAt, nowMs, maxAgeMs)) return false;

  if (entityType === 'team' || entityType === 'game') return true;

  const sport = String(leg?.sport ?? '').toLowerCase();
  const side = String(leg?.side ?? '').toLowerCase();
  const line = leg?.line ?? leg?.target_line;
  return (side === 'over' || side === 'under') && propLineIntegrity(sport, leg?.market, line).valid;
}

function confidenceOf(leg: Record<string, any>): number {
  return toConfidence(leg?.confidence ?? leg?.model_probability) ?? 0;
}

function bestSameGamePool<T extends Record<string, any>>(
  legs: T[],
  policy: ParlayQualityPolicy,
): QualityFilterResult<T> {
  const groups = new Map<string, T[]>();
  for (const leg of legs) {
    const key = eventKey(leg);
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), leg]);
  }

  const ranked = [...groups.values()]
    .map((group) => filterParlayQuality(group, policy))
    .sort((a, b) =>
      Number(b.legs.length >= (policy.requestedMin ?? 1)) - Number(a.legs.length >= (policy.requestedMin ?? 1))
      || b.legs.length - a.legs.length
      || b.legs.reduce((sum, leg) => sum + confidenceOf(leg), 0)
        - a.legs.reduce((sum, leg) => sum + confidenceOf(leg), 0)
    );
  return ranked[0] ?? { legs: [], blocked: [], coreCount: 0, supplementalCount: 0 };
}

/**
 * Final all-or-nothing parlay gate. It pools every structured candidate,
 * rejects stale/model-only lines, deduplicates legs, backfills from ranked
 * alternates, and emits no slip unless the requested minimum is satisfied.
 */
export function finalizeStructuredParlay<T extends Record<string, any>>(
  rawLegs: T[],
  policy: ParlayQualityPolicy,
  nowMs = Date.now(),
): StructuredParlayResult<T> {
  const unique: T[] = [];
  const duplicates: T[] = [];
  const seen = new Set<string>();
  for (const leg of Array.isArray(rawLegs) ? rawLegs : []) {
    const key = structuredLegKey(leg);
    if (!normalizedSelection(leg) || seen.has(key)) {
      duplicates.push(leg);
      continue;
    }
    seen.add(key);
    unique.push(leg);
  }

  const current: T[] = [];
  const lineBlocked: T[] = [];
  for (const leg of unique) {
    if (hasCurrentMarketLine(leg, nowMs)) current.push(leg);
    else lineBlocked.push(leg);
  }

  const quality = policy.sameGameIntent
    ? bestSameGamePool(current, policy)
    : filterParlayQuality(current, policy);
  const shortfall = requestedParlayShortfall(policy, quality.legs.length);
  const complete = quality.legs.length > 0 && shortfall === 0;

  return {
    legs: complete ? quality.legs : [],
    qualified: quality.legs,
    blocked: [...duplicates, ...quality.blocked],
    lineBlocked,
    complete,
    shortfall,
    requestedMin: policy.requestedMin,
    requestedMax: policy.requestedMax,
  };
}

export function requestedParlayShortfall(policy: ParlayQualityPolicy, actualCount: number): number {
  if (policy.requestedMin == null) return 0;
  return Math.max(0, policy.requestedMin - actualCount);
}
