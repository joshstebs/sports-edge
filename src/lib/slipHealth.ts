import type { SgpLeg } from '../types';

export type SlipHealthLevel = 'strong' | 'good' | 'aggressive' | 'unscored';

export interface SlipHealth {
  level: SlipHealthLevel;
  label: string;
  averageConfidence: number | null;
  weakestConfidence: number | null;
  scoredLegs: number;
  totalLegs: number;
  uniqueEvents: number;
  duplicateEventLegs: number;
  negativeCorrelations: number;
  summary: string;
}

function normalizedConfidence(value: unknown): number | null {
  if (value == null) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.max(0, Math.min(100, number));
}

function eventKey(leg: SgpLeg): string {
  const eventId = String(leg.eventId ?? '').trim();
  if (eventId) return eventId;
  const game = String(leg.game ?? '').trim().toLowerCase();
  const date = String(leg.eventDate ?? '').slice(0, 10);
  return game ? `${game}|${date}` : '';
}

function hasNegativeCorrelation(leg: SgpLeg): boolean {
  return /\b(?:negative|conflict|opposes|anti[- ]?correlated)\b/i.test(String(leg.correlation ?? ''));
}

export function analyzeSlipHealth(legs: SgpLeg[]): SlipHealth {
  const list = Array.isArray(legs) ? legs : [];
  const confidences = list
    .map((leg) => normalizedConfidence(leg.confidence))
    .filter((value): value is number => value != null);
  const weakestConfidence = confidences.length ? Math.min(...confidences) : null;
  const averageConfidence = confidences.length
    ? Math.round((confidences.reduce((sum, value) => sum + value, 0) / confidences.length) * 10) / 10
    : null;

  const eventKeys = list.map(eventKey).filter(Boolean);
  const uniqueEvents = new Set(eventKeys).size;
  const duplicateEventLegs = Math.max(0, eventKeys.length - uniqueEvents);
  const negativeCorrelations = list.filter(hasNegativeCorrelation).length;

  let level: SlipHealthLevel;
  let label: string;
  if (confidences.length !== list.length || weakestConfidence == null) {
    level = 'unscored';
    label = 'Needs review';
  } else if (weakestConfidence < 58) {
    level = 'aggressive';
    label = 'Aggressive';
  } else if (weakestConfidence >= 65 && negativeCorrelations === 0 && duplicateEventLegs === 0) {
    level = 'strong';
    label = 'Strong';
  } else {
    level = 'good';
    label = 'Good';
  }

  let summary: string;
  if (!list.length) {
    summary = 'Add verified picks to see slip quality.';
  } else if (confidences.length !== list.length) {
    summary = `${confidences.length}/${list.length} legs are scored. Review unscored legs before relying on the slip.`;
  } else if (negativeCorrelations > 0) {
    summary = `${negativeCorrelations} leg${negativeCorrelations === 1 ? '' : 's'} show negative/conflicting correlation. Review the game script.`;
  } else if (duplicateEventLegs > 0) {
    summary = `${duplicateEventLegs + 1} or more legs share games. Confidence is solid, but same-game correlation increases concentration.`;
  } else {
    summary = 'Scored legs are diversified across games with no explicit negative-correlation warning.';
  }

  return {
    level,
    label,
    averageConfidence,
    weakestConfidence,
    scoredLegs: confidences.length,
    totalLegs: list.length,
    uniqueEvents,
    duplicateEventLegs,
    negativeCorrelations,
    summary,
  };
}

export function formatParlayForClipboard(legs: SgpLeg[]): string {
  const list = Array.isArray(legs) ? legs : [];
  if (!list.length) return 'SportsEdge parlay: no picks';
  const rows = list.map((leg, index) => {
    const context = [leg.sport, leg.game].filter(Boolean).join(' · ');
    const confidence = normalizedConfidence(leg.confidence);
    const details = [
      leg.selection || 'Unnamed selection',
      confidence != null ? `${confidence}% confidence` : null,
      typeof leg.odds === 'number' && Number.isFinite(leg.odds) ? `${leg.odds > 0 ? '+' : ''}${leg.odds}` : null,
    ].filter(Boolean).join(' | ');
    return `${index + 1}. ${details}${context ? `\n   ${context}` : ''}`;
  });
  return ['SportsEdge Parlay', ...rows].join('\n');
}
