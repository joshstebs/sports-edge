export interface ParlayQualityPolicy {
  aggressive: boolean;
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

export function parseParlayQualityPolicy(text: string): ParlayQualityPolicy {
  const normalized = String(text ?? '').toLowerCase();
  const aggressive = /\b(?:aggressive|high[- ]?risk|long[- ]?shot|lottery|moonshot)\b/i.test(normalized);

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
    minConfidence: aggressive ? 50 : 58,
    requestedMin,
    requestedMax,
  };
}

/**
 * Final server-side recommendation gate.
 * - D-grade / <50% legs are always rejected.
 * - Normal parlays require B-or-better (>=58%).
 * - Explicit aggressive requests may include C (>=50%).
 * - Missing confidence fails closed on recommendation paths.
 * - Team/game legs without model confidence are preserved because player_prop_model
 *   does not grade those markets today; their upstream odds/availability checks still apply.
 */
export function filterParlayQuality<T extends Record<string, any>>(
  rawLegs: T[],
  policy: ParlayQualityPolicy,
): QualityFilterResult<T> {
  const legs: T[] = [];
  const blocked: T[] = [];

  for (const leg of Array.isArray(rawLegs) ? rawLegs : []) {
    const entityType = String(leg?.entity_type ?? '').toLowerCase();
    if (entityType === 'team' || entityType === 'game') {
      legs.push(leg);
      continue;
    }

    const confidence = toConfidence(leg?.confidence ?? leg?.model_probability);
    if (confidence == null || confidence < 50 || confidence < policy.minConfidence) {
      blocked.push(leg);
      continue;
    }
    legs.push(leg);
  }

  return { legs, blocked };
}

export function requestedParlayShortfall(policy: ParlayQualityPolicy, actualCount: number): number {
  if (policy.requestedMin == null) return 0;
  return Math.max(0, policy.requestedMin - actualCount);
}
