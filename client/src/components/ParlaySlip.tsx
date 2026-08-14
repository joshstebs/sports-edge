import { useMemo } from 'react';
import {
  americanToDecimal,
  combineDecimalOdds,
  decimalToAmerican,
  formatAmerican,
  gradeForConfidence,
  legKey,
  type Grade,
} from '../lib/odds';
import type { SgpLeg } from '../types';

interface ParlaySlipProps {
  legs: SgpLeg[];
  onRemove: (key: string) => void;
  className?: string;
}

const DOT: Record<Grade, string> = {
  A: 'bg-edge shadow-[0_0_6px_rgba(21,255,194,0.8)]',
  B: 'bg-sky2 shadow-[0_0_6px_rgba(72,231,254,0.8)]',
  C: 'bg-warn shadow-[0_0_6px_rgba(240,192,64,0.8)]',
  D: 'bg-danger shadow-[0_0_6px_rgba(255,21,82,0.8)]',
};

/**
 * Sticky Parlay Slip side panel. Legs come from every SGP event in the
 * conversation (deduped by selection+line, latest wins). The combined price is
 * real arithmetic on real odds only: decimal odds of legs WITH odds are
 * multiplied and converted back to American. If any leg is unpriced we show
 * '—' instead of pretending the full ticket has a price.
 */
export default function ParlaySlip({ legs, onRemove, className = '' }: ParlaySlipProps) {
  const combined = useMemo(() => {
    if (legs.length === 0) return null;
    const allPriced = legs.every((l) => typeof l.odds === 'number' && Number.isFinite(l.odds));
    if (!allPriced) return null;
    const product = combineDecimalOdds(legs.map((l) => americanToDecimal(l.odds as number)));
    return product == null ? null : decimalToAmerican(product);
  }, [legs]);

  return (
    <aside
      className={`flex flex-col overflow-hidden rounded-2xl border border-line/70 bg-panel/90 shadow-[0_8px_30px_rgba(0,0,0,0.35)] backdrop-blur ${className}`}
    >
      <div className="flex shrink-0 items-center justify-between border-b border-line/70 bg-panel2/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4 text-edge"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M8 21h12M12 17v4M17 3H7a1 1 0 00-1 1v12a1 1 0 001 1h10a1 1 0 001-1V4a1 1 0 00-1-1z" />
            <path d="M9 7h6M9 11h6" />
          </svg>
          <h2 className="font-display text-sm font-bold tracking-tight text-head">Parlay Slip</h2>
        </div>
        <span className="rounded-full bg-edge/10 px-2 py-0.5 text-[10px] font-bold tabular-nums text-edge ring-1 ring-edge/25">
          {legs.length} {legs.length === 1 ? 'leg' : 'legs'}
        </span>
      </div>

      {legs.length === 0 ? (
        <p className="px-4 py-5 text-center text-xs leading-relaxed text-frost2">
          No picks yet — SGP legs from the analyst stack here.
        </p>
      ) : (
        <ul className="min-h-0 flex-1 divide-y divide-line/50 overflow-y-auto">
          {legs.map((leg) => {
            const grade = typeof leg.confidence === 'number' ? gradeForConfidence(leg.confidence) : null;
            const line = leg.line != null && leg.line !== '' ? ` ${leg.line}` : '';
            return (
              <li
                key={legKey(leg)}
                className="group relative px-4 py-2.5 transition hover:bg-panel2/40"
              >
                <div className="flex items-start gap-2 pr-6">
                  <span
                    className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${grade ? DOT[grade.grade] : 'bg-slate-600'}`}
                    title={grade ? `AI Grade ${grade.grade} — ${grade.label}` : 'No confidence grade'}
                  />
                  <p className="line-clamp-3 min-w-0 flex-1 text-xs font-semibold leading-snug text-head">
                    {leg.selection || '—'}
                  </p>
                  <button
                    onClick={() => onRemove(legKey(leg))}
                    title="Remove from slip"
                    aria-label="Remove from slip"
                    className="absolute right-3 top-2.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-frost2 transition hover:bg-danger/15 hover:text-danger"
                  >
                    <svg
                      viewBox="0 0 20 20"
                      className="h-3 w-3"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      aria-hidden="true"
                    >
                      <path d="M6 6l8 8M14 6l-8 8" />
                    </svg>
                  </button>
                </div>
                <p className="mt-0.5 line-clamp-2 pl-4 text-[10px] leading-snug text-frost2">
                  {[leg.sport, leg.game].filter(Boolean).join(' · ') || '—'}
                  {leg.market ? ` · ${leg.market}${line}` : ''}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-4">
                  <span
                    className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold tabular-nums ring-1 ${
                      leg.odds != null
                        ? 'bg-edge/10 text-edge ring-edge/25'
                        : 'bg-slate-700/30 text-frost2 ring-line'
                    }`}
                  >
                    {leg.odds != null ? formatAmerican(leg.odds) : 'Odds N/A'}
                  </span>
                  {leg.game_odds ? (
                    <span
                      title="Real game moneyline (ESPN → DraftKings); prop-level price unavailable"
                      className="rounded-md bg-warn/10 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-warn ring-1 ring-warn/25"
                    >
                      Game ML {leg.game_odds}
                    </span>
                  ) : null}
                  {grade ? (
                    <span
                      className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold tabular-nums ring-1 ${
                        grade.grade === 'A'
                          ? 'bg-edge/10 text-edge ring-edge/25'
                          : grade.grade === 'B'
                            ? 'bg-sky2/10 text-sky2 ring-sky2/25'
                            : grade.grade === 'C'
                              ? 'bg-warn/10 text-warn ring-warn/25'
                              : 'bg-danger/10 text-danger ring-danger/25'
                      }`}
                      title={grade.label}
                    >
                      Grade {grade.grade} · {leg.confidence}%
                    </span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="shrink-0 border-t border-line/70 bg-panel2/50 px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-frost2">
            Combined (legs with odds only)
          </span>
          <span
            className={`text-sm font-extrabold tabular-nums ${combined != null ? 'text-edge' : 'text-frost2'}`}
            title={combined == null && legs.length > 0 ? 'not all legs priced' : undefined}
          >
            {combined != null ? formatAmerican(combined) : '—'}
          </span>
        </div>
        <p className="mt-1.5 text-[10px] leading-snug text-frost2/80">
          Parlays amplify variance — size in fractional units. Play responsibly.
        </p>
      </div>
    </aside>
  );
}
