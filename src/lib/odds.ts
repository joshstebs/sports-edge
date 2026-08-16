// Odds + EV math. Every function here is derived arithmetic on REAL fields that
// arrive from the backend (SgpLeg.odds, SgpLeg.confidence). Nothing is invented:
// if an input is missing or unusable the functions return NaN/null and callers
// hide the derived value instead of showing a made-up number.

/** Implied probability from American odds: +250 → 100/350 = 0.2857; -130 → 130/230 = 0.5652. */
export function americanToImplied(odds: number): number {
  if (!Number.isFinite(odds) || odds === 0) return NaN;
  return odds > 0 ? 100 / (100 + odds) : -odds / (-odds + 100);
}

/** Decimal odds from American odds: -130 → 1.7692; +150 → 2.5. */
export function americanToDecimal(odds: number): number {
  if (!Number.isFinite(odds) || odds === 0) return NaN;
  return odds > 0 ? 1 + odds / 100 : 1 + 100 / -odds;
}

/** American odds from decimal (rounded). null for invalid/even-money-or-worse inputs. */
export function decimalToAmerican(decimal: number): number | null {
  if (!Number.isFinite(decimal) || decimal <= 1) return null;
  return decimal >= 2 ? Math.round((decimal - 1) * 100) : -Math.round(100 / (decimal - 1));
}

/** Multiply decimal odds (real legs only). Returns null when nothing valid to combine. */
export function combineDecimalOdds(decimals: number[]): number | null {
  const valid = decimals.filter((d) => Number.isFinite(d) && d > 1);
  if (valid.length === 0) return null;
  return valid.reduce((acc, d) => acc * d, 1);
}

/** EV = (confidence/100) × decimal odds − 1. NaN when inputs are unusable. */
export function evFromConfidence(confidence: number, americanOdds: number): number {
  if (!Number.isFinite(confidence) || !Number.isFinite(americanOdds) || americanOdds === 0) return NaN;
  const decimal = americanToDecimal(americanOdds);
  if (!Number.isFinite(decimal)) return NaN;
  return (confidence / 100) * decimal - 1;
}

export type Grade = 'A' | 'B' | 'C' | 'D';

/** AI grade thresholds (confidence-derived): A ≥ 65, B ≥ 58, C ≥ 50, D < 50. */
export function gradeForConfidence(confidence: number): { grade: Grade; label: string } {
  if (confidence >= 65) return { grade: 'A', label: 'Strong' };
  if (confidence >= 58) return { grade: 'B', label: 'Good' };
  if (confidence >= 50) return { grade: 'C', label: 'Average' };
  return { grade: 'D', label: 'Weak' };
}

function normalizeKeyPart(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

/**
 * Stable identity for one wager. Odds and confidence are intentionally omitted
 * so a later recommendation can refresh those values without duplicating the
 * same leg. Game and market are included so equal player/line text in different
 * matchups or prop markets never collides in the bet slip.
 */
export function legKey(leg: {
  sport?: string;
  game?: string;
  eventId?: string;
  selection?: string;
  market?: string;
  line?: string | number | null;
}): string {
  return [leg.sport, leg.game, leg.eventId, leg.selection, leg.market, leg.line]
    .map(normalizeKeyPart)
    .join('::');
}

/** American odds as display text: +150 stays +150, -130 stays -130. */
export function formatAmerican(odds: number): string {
  return odds > 0 ? `+${odds}` : String(odds);
}
