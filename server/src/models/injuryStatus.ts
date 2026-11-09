/**
 * Injury-designation vocabulary shared by the roster/injury gate and the
 * event-specific game-day check.
 *
 * ESPN's league injury feed is not a list of injured players: the NFL feed
 * carries every rostered player, most with `status: "Active"`. Treating any
 * row in that feed as an injury blocks entire leagues (verified 2026-11-09:
 * all 800 NFL rows, healthy starters included, were "listed Active"). Only a
 * real designation may block a recommendation.
 */

const BENIGN = new Set([
  '', 'active', 'healthy', 'available', 'none', 'probable', 'cleared', 'normal',
]);

export function normalizeInjuryStatus(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

/** True only for a designation that should withhold a player-prop recommendation. */
export function isBlockingInjuryStatus(value: unknown): boolean {
  const status = normalizeInjuryStatus(value);
  if (BENIGN.has(status)) return false;
  return true;
}

/** Keep only rows that represent an actual injury designation. */
export function blockingInjuries<T extends { status?: unknown }>(rows: T[] | null | undefined): T[] {
  return (Array.isArray(rows) ? rows : []).filter((row) => isBlockingInjuryStatus(row?.status));
}
