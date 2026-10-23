import type { SgpLeg } from '../types';
import { analyzeSlipHealth } from '../lib/slipHealth';

function unpriced(leg: SgpLeg): boolean {
  return typeof leg.odds !== 'number' || !Number.isFinite(leg.odds);
}

function availabilityNote(leg: SgpLeg): string | null {
  const note = String(leg.__gateNote ?? '').trim();
  return note || null;
}

/**
 * Visualizes only what the slip and the existing health helper already know.
 * It does not estimate a combined win probability or a correlation coefficient.
 */
export default function SlipRisk({ legs }: { legs: SgpLeg[] }) {
  const health = analyzeSlipHealth(legs);
  const missingPrice = legs.filter(unpriced);
  const availability = legs.filter((leg) => availabilityNote(leg));
  const sameGame = legs.filter((leg) => {
    const game = String(leg.game ?? '').trim().toLowerCase();
    if (!game) return false;
    return legs.filter((other) => String(other.game ?? '').trim().toLowerCase() === game).length > 1;
  });

  const rows = [
    { label: 'Scored legs', value: `${health.scoredLegs}/${health.totalLegs}`, warn: health.scoredLegs !== health.totalLegs },
    { label: 'Same-game legs', value: String(sameGame.length), warn: health.duplicateEventLegs > 0 },
    { label: 'Conflicting correlation notes', value: String(health.negativeCorrelations), warn: health.negativeCorrelations > 0 },
    { label: 'Unpriced legs', value: String(missingPrice.length), warn: missingPrice.length > 0 },
    { label: 'Availability notes', value: String(availability.length), warn: availability.length > 0 },
  ];

  return (
    <section aria-label="Parlay risk" className="border border-line bg-ink/40 p-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="kicker">Risk analyzer</p>
          <h3 className="display mt-1 text-2xl text-head">{health.label}</h3>
        </div>
        <p className="max-w-sm text-xs leading-relaxed text-frost2">{health.summary}</p>
      </div>
      <ul className="mt-4 grid gap-px bg-line sm:grid-cols-5">
        {rows.map((row) => (
          <li key={row.label} className="bg-panel px-3 py-3">
            <p className="kicker">{row.label}</p>
            <p className={`num mt-2 text-xl ${row.warn ? 'text-warn' : 'text-head'}`}>{row.value}</p>
          </li>
        ))}
      </ul>
      <ul className="mt-4 space-y-2 text-sm text-frost">
        {health.duplicateEventLegs > 0 && <li>Multiple legs share a game. That is concentration, not an independence assumption.</li>}
        {health.negativeCorrelations > 0 && <li>At least one leg already carries a negative or conflicting correlation note from the model.</li>}
        {missingPrice.length > 0 && <li>{missingPrice.length} leg{missingPrice.length === 1 ? ' has' : 's have'} no stored American price. Combined odds stay withheld.</li>}
        {availability.length > 0 && <li>{availability.length} leg{availability.length === 1 ? '' : 's'} include an availability-gate note. Recheck before use.</li>}
        {legs.some((leg) => leg.game_odds && unpriced(leg)) && <li>A game moneyline is present on a leg that still has no prop price. The moneyline is not treated as the selection price.</li>}
      </ul>
      <p className="mt-3 text-xs leading-relaxed text-frost2">
        This panel does not invent a correlation coefficient or a combined win probability. Average confidence is {health.averageConfidence != null ? `${health.averageConfidence}%` : 'unavailable'} across scored legs only.
      </p>
    </section>
  );
}
