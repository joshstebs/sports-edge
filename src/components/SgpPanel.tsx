import {
  americanToImplied,
  evFromConfidence,
  formatAmerican,
  gradeForConfidence,
  type Grade,
} from '../lib/odds';
import type { SgpLeg } from '../types';

const GRADE_STYLES: Record<Grade, string> = {
  A: 'bg-edge/15 text-edge ring-edge/40 shadow-[0_0_10px_rgba(21,255,194,0.18)]',
  B: 'bg-sky2/15 text-sky2 ring-sky2/40',
  C: 'bg-warn/15 text-warn ring-warn/40',
  D: 'bg-danger/15 text-danger ring-danger/40',
};

function confClasses(c: number | undefined): string {
  if (c == null) return 'bg-slate-500/15 text-slate-300 ring-slate-500/40';
  if (c >= 75) return 'bg-edge/10 text-edge ring-edge/30';
  if (c >= 55) return 'bg-warn/10 text-warn ring-warn/30';
  return 'bg-danger/10 text-danger ring-danger/30';
}

/** EV chip colors: mint ≥ +5%, amber ≥ 0, red below. */
function evClasses(ev: number): string {
  if (ev >= 0.05) return 'bg-edge/10 text-edge ring-edge/30 shadow-[0_0_10px_rgba(21,255,194,0.15)]';
  if (ev >= 0) return 'bg-warn/10 text-warn ring-warn/30';
  return 'bg-danger/10 text-danger ring-danger/30';
}

function formatEv(ev: number): string {
  const pct = ev * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

function LegCard({ leg, index }: { leg: SgpLeg; index: number }) {
  const line = leg.line != null && leg.line !== '' ? ` ${leg.line}` : '';
  const grade = typeof leg.confidence === 'number' ? gradeForConfidence(leg.confidence) : null;
  const implied = typeof leg.odds === 'number' ? americanToImplied(leg.odds) : NaN;
  const ev =
    typeof leg.odds === 'number' && typeof leg.confidence === 'number'
      ? evFromConfidence(leg.confidence, leg.odds)
      : NaN;

  return (
    <div className="flex flex-col gap-2.5 rounded-xl border border-line/70 bg-panel/80 p-3.5 transition hover:border-edge/30 hover:shadow-[0_0_18px_rgba(21,255,194,0.07)]">
      {/* Pick title + game meta — full card width, grade sits BELOW */}
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-edge/15 text-[10px] font-extrabold tabular-nums text-edge ring-1 ring-edge/35">
          {index + 1}
        </span>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-3 break-words text-sm font-semibold leading-snug text-head">{leg.selection || '—'}</p>
          <p className="mt-0.5 line-clamp-2 break-words text-[11px] text-frost2">
            {[leg.sport, leg.game].filter(Boolean).join(' · ') || '—'}
          </p>
        </div>
      </div>

      {/* Chips row: grade, confidence, market, odds, EV */}
      <div className="flex flex-wrap items-center gap-1.5">
        {grade && (
          <span
            className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold ring-1 ${GRADE_STYLES[grade.grade]}`}
            title="AI Grade — model confidence-derived (A ≥ 65, B ≥ 58, C ≥ 50, D < 50)"
          >
            AI {grade.grade} · {grade.label}
          </span>
        )}
        {typeof leg.confidence === 'number' && (
          <span
            className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold tabular-nums ring-1 ${confClasses(leg.confidence)}`}
          >
            Conf {Math.round(leg.confidence)}%
          </span>
        )}
        <span className="rounded-md border border-line/70 bg-panel2/80 px-2 py-0.5 text-[11px] font-semibold text-frost">
          {leg.market || 'Market'}
          {line}
        </span>
        {leg.odds != null ? (
          <span className="inline-flex items-center gap-1.5 rounded-md border border-edge/25 bg-edge/10 px-2 py-0.5 text-[11px] font-bold tabular-nums text-edge">
            {formatAmerican(leg.odds)}
            {Number.isFinite(implied) && (
              <span className="font-semibold text-edge/70">· {(implied * 100).toFixed(1)}% imp</span>
            )}
          </span>
        ) : leg.game_odds ? (
          <span
            className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-bold tabular-nums text-amber-300"
            title="Real game moneyline (ESPN → DraftKings). The prop's own market price isn't available without a book feed, so this is the game line for context."
          >
            Game ML {leg.game_odds}
          </span>
        ) : (
          <span className="rounded-md border border-line bg-panel2/80 px-2 py-0.5 text-[11px] font-semibold text-frost2">
            Odds N/A
          </span>
        )}
        {Number.isFinite(ev) && (
          <span
            className={`rounded-md px-2 py-0.5 text-[11px] font-bold tabular-nums ring-1 ${evClasses(ev)}`}
            title="EV = model confidence × decimal odds − 1 (confidence-derived)"
          >
            EV {formatEv(ev)}
          </span>
        )}
      </div>

      {leg.justification && (
        <p className="text-xs leading-relaxed text-frost2">{leg.justification}</p>
      )}

      <div className="flex flex-wrap gap-1.5">
        {leg.risk && (
          <span className="rounded-md bg-warn/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warn/90 ring-1 ring-warn/25">
            Risk: {leg.risk}
          </span>
        )}
        {leg.correlation && (
          <span className="inline-flex items-center gap-1 rounded-md bg-aqua/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky2/90 ring-1 ring-aqua/25">
            <svg
              viewBox="0 0 24 24"
              className="h-3 w-3"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
            </svg>
            {leg.correlation}
          </span>
        )}
      </div>
    </div>
  );
}

export default function SgpPanel({ legs }: { legs: SgpLeg[] }) {
  return (
    <div className="mt-4 overflow-hidden rounded-2xl border border-edge/20 bg-panel/80 shadow-[0_8px_30px_rgba(0,0,0,0.35)] backdrop-blur">
      <div className="flex items-center justify-between border-b border-edge/15 bg-panel2/50 px-4 py-2.5">
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
          <h3 className="font-display text-sm font-bold tracking-tight text-edge">Same Game Parlay</h3>
        </div>
        <span className="rounded-full border border-edge/25 bg-ink/60 px-2 py-0.5 text-[10px] font-bold tabular-nums text-edge">
          {legs.length}-leg Slip
        </span>
      </div>

      <div className="grid gap-3 p-4 sm:grid-cols-2">
        {legs.map((leg, i) => (
          <LegCard key={i} leg={leg} index={i} />
        ))}
      </div>

      <p className="border-t border-edge/10 px-4 py-2.5 text-[11px] text-frost2">
        Parlays are correlated-risk bets — variance is amplified. Size in fractional units.
      </p>
    </div>
  );
}
