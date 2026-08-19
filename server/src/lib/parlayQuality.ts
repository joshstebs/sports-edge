export interface ParlayQualityPolicy {
  aggressive: boolean;
  sameGameIntent: boolean;
  minConfidence: number;
  requestedMin: number | null;
  requestedMax: number | null;
}

export interface QualityFilterResult<T = any> {
  legs: T[];
  blocked: T[];
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
  const normalized = String(text ?? '').toLowerCase();
  const aggressive = /\b(?:aggressive|high[- ]?risk|long[- ]?shot|lottery|moonshot)\b/i.test(normalized);
  const sameGameIntent = /\b(?:same[- ]?game|sgp)\b/i.test(normalized);

  const range = normalized.match(/\b(\d{1,2})\s*(?:-|–|—|to)\s*(\d{1,2})\s*(?:leg|legs|game|games|pick|picks)?\b/i);
  const single = normalized.match(/\b(\d{1,2})\s*(?:leg|legs|game|games|pick|picks)\b/i);
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

  return {
    aggressive,
    sameGameIntent,
    minConfidence: aggressive ? 50 : 58,
    requestedMin,
    requestedMax,
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

  // For normal cross-slate parlays, prefer one high-quality leg per event before
  // adding a second leg from the same game. This reduces accidental dependency
  // and concentration without blocking an intentional SGP request.
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

/**
 * Final server-side recommendation gate.
 * - D-grade / <50% legs are always rejected.
 * - Normal parlays require B-or-better (>=58%).
 * - Explicit aggressive requests may include C (>=50%).
 * - Missing confidence fails closed on recommendation paths.
 * - Team/game markets must have both a numeric confidence and an attributable
 *   model/quality source; unscored markets remain analysis-only.
 * - Explicit negative-correlation legs are rejected for normal parlays.
 * - Passing legs are ranked by confidence and, unless SGP was requested,
 *   diversified across events before duplicate-game legs are considered.
 */
export function filterParlayQuality<T extends Record<string, any>>(
  rawLegs: T[],
  policy: ParlayQualityPolicy,
): QualityFilterResult<T> {
  const accepted: T[] = [];
  const blocked: T[] = [];

  for (const leg of Array.isArray(rawLegs) ? rawLegs : []) {
    const entityType = String(leg?.entity_type ?? '').toLowerCase();
    const confidence = toConfidence(leg?.confidence ?? leg?.model_probability);

    if (confidence == null || confidence < 50 || confidence < policy.minConfidence) {
      blocked.push(leg);
      continue;
    }

    if ((entityType === 'team' || entityType === 'game') && !qualitySource(leg)) {
      blocked.push(leg);
      continue;
    }

    if (!policy.aggressive && isExplicitlyNegativeCorrelation(leg)) {
      blocked.push(leg);
      continue;
    }

    accepted.push(leg);
  }

  return { legs: rankParlayCandidates(accepted, policy), blocked };
}

export function requestedParlayShortfall(policy: ParlayQualityPolicy, actualCount: number): number {
  if (policy.requestedMin == null) return 0;
  return Math.max(0, policy.requestedMin - actualCount);
}
