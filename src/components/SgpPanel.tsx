import {
  americanToImplied,
  evFromConfidence,
  formatAmerican,
  gradeForConfidence,
  legKey,
  type Grade,
} from '../lib/odds';
import type { SgpLeg } from '../types';

const GRADE_TONE: Record<Grade, string> = {
  A: 'text-edge border-edge/45 bg-edge/10',
  B: 'text-sky2 border-sky2/45 bg-sky2/10',
  C: 'text-warn border-warn/45 bg-warn/10',
  D: 'text-danger border-danger/45 bg-danger/10',
};

function formatEv(ev: number): string {
  const pct = ev * 100;
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

function initials(selection: string | undefined): string {
  const clean = (selection ?? 'SE').replace(/\b(over|under|to|record|score|made|points?|rebounds?|assists?|hits?|runs?|yards?|touchdowns?)\b/gi, '').trim();
  const parts = clean.split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase()).join('') || 'SE';
}

function LegCard({ leg, index }: { leg: SgpLeg; index: number }) {
  const grade = typeof leg.confidence === 'number' ? gradeForConfidence(leg.confidence) : null;
  const implied = typeof leg.odds === 'number' ? americanToImplied(leg.odds) : NaN;
  const ev = typeof leg.odds === 'number' && typeof leg.confidence === 'number'
    ? evFromConfidence(leg.confidence, leg.odds)
    : NaN;
  const line = leg.line != null && leg.line !== '' ? String(leg.line) : '—';

  return (
    <article className="se-glow-card overflow-hidden rounded-2xl">
      <div className="flex items-start gap-3 border-b border-line/60 p-4 sm:p-5">
        <div className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-edge/30 bg-gradient-to-br from-edge/15 to-aqua/10 text-[14px] font-black text-edge">
          {initials(leg.selection)}
          <span className="absolute -left-1 -top-1 flex h-5 w-5 items-center justify-center rounded-md border border-edge/45 bg-ink text-[9px] font-black text-edge">{index + 1}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="se-kicker">SportsEdge AI · recommended</span>
            <span className="se-verified !px-2 !py-1">✓ verified</span>
          </div>
          <h4 className="mt-2 text-[17px] font-bold leading-snug text-head">{leg.selection || 'Recommendation'}</h4>
          <p className="mt-1 text-[11px] text-frost2">{[leg.sport, leg.game].filter(Boolean).join(' · ') || 'Verified market recommendation'}</p>
        </div>
        {grade ? <span className={`se-grade ${GRADE_TONE[grade.grade]}`}>{grade.grade}{grade.grade === 'A' && typeof leg.confidence === 'number' && leg.confidence < 70 ? '-' : ''}</span> : null}
      </div>

      <div className="grid grid-cols-2 gap-px bg-line/50 sm:grid-cols-4">
        <div className="bg-ink/70 p-3.5">
          <span className="se-kicker !text-frost2">Line</span>
          <p className="mt-1.5 text-xl font-bold text-head">{line}</p>
          <p className="mt-1 text-[9px] text-frost2">{leg.market || 'Market'}</p>
        </div>
        <div className="bg-ink/70 p-3.5">
          <span className="se-kicker !text-frost2">Odds</span>
          <p className={`mt-1.5 text-xl font-bold ${leg.odds != null ? 'text-edge' : 'text-frost2'}`}>{leg.odds != null ? formatAmerican(leg.odds) : 'N/A'}</p>
          <p className="mt-1 text-[9px] text-frost2">{Number.isFinite(implied) ? `${(implied * 100).toFixed(1)}% implied` : leg.game_odds ? `Game ML ${leg.game_odds}` : 'No verified prop price'}</p>
        </div>
        <div className="bg-ink/70 p-3.5">
          <span className="se-kicker !text-frost2">Model prob</span>
          <p className={`mt-1.5 text-xl font-bold ${typeof leg.confidence === 'number' ? 'text-sky2' : 'text-frost2'}`}>{typeof leg.confidence === 'number' ? `${leg.confidence.toFixed(1)}%` : '—'}</p>
          <div className="se-confidence-bars mt-2" aria-hidden="true"><span /><span /><span /><span /><span /><span /></div>
        </div>
        <div className="bg-ink/70 p-3.5">
          <span className="se-kicker !text-frost2">EV edge</span>
          <p className={`mt-1.5 text-xl font-bold ${Number.isFinite(ev) && ev >= 0 ? 'text-edge' : Number.isFinite(ev) ? 'text-danger' : 'text-frost2'}`}>{Number.isFinite(ev) ? formatEv(ev) : '—'}</p>
          <p className="mt-1 text-[9px] text-frost2">{Number.isFinite(ev) ? 'Confidence vs price' : 'Needs verified price'}</p>
        </div>
      </div>

      {leg.justification ? (
        <div className="p-4 sm:p-5">
          <p className="se-kicker">AI takeaway</p>
          <p className="mt-2 text-[12px] leading-6 text-frost">{leg.justification}</p>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-2 border-t border-line/60 p-3 sm:grid-cols-4">
        <div className="rounded-lg border border-line/70 bg-panel2/45 px-2.5 py-2"><p className="text-[9px] uppercase tracking-wider text-frost2">Odds</p><p className="mt-1 text-[10px] font-semibold text-edge">{leg.odds != null ? 'Verified price' : 'Price withheld'}</p></div>
        <div className="rounded-lg border border-line/70 bg-panel2/45 px-2.5 py-2"><p className="text-[9px] uppercase tracking-wider text-frost2">Availability</p><p className="mt-1 text-[10px] font-semibold text-frost">Checked by research</p></div>
        <div className="rounded-lg border border-line/70 bg-panel2/45 px-2.5 py-2"><p className="text-[9px] uppercase tracking-wider text-frost2">Risk</p><p className="mt-1 truncate text-[10px] font-semibold text-warn" title={leg.risk || 'See analysis'}>{leg.risk || 'See analysis'}</p></div>
        <div className="rounded-lg border border-line/70 bg-panel2/45 px-2.5 py-2"><p className="text-[9px] uppercase tracking-wider text-frost2">Correlation</p><p className="mt-1 truncate text-[10px] font-semibold text-sky2" title={leg.correlation || 'Independent check'}>{leg.correlation || 'Independent check'}</p></div>
      </div>
    </article>
  );
}

export default function SgpPanel({ legs }: { legs: SgpLeg[] }) {
  return (
    <section className="mt-5 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="se-kicker">Research first. Pick second.</p>
          <h3 className="mt-1 text-[15px] font-bold text-head">Verified recommendation set</h3>
        </div>
        <span className="rounded-lg border border-edge/35 bg-edge/10 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-edge">{legs.length} {legs.length === 1 ? 'pick' : 'legs'}</span>
      </div>

      <div className="grid gap-3">
        {legs.map((leg, i) => <LegCard key={legKey(leg)} leg={leg} index={i} />)}
      </div>

      <p className="se-bottom-legal px-1">Recommendation cards display real structured data returned by the analyst. A sportsbook price is shown only when one was captured; otherwise price-dependent EV is withheld.</p>
    </section>
  );
}
