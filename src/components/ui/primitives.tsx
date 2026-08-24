import type { ReactNode } from 'react';

/** Skeleton block for loading states — never render blank panels. */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl border border-line/60 bg-panel2/40 ${className}`} aria-hidden="true" />;
}

export function Stat({ label, value, sub, tone = 'default' }: { label: string; value: string; sub?: string; tone?: 'default' | 'positive' | 'negative' }) {
  const toneClass = tone === 'positive' ? 'text-edge' : tone === 'negative' ? 'text-danger' : 'text-head';
  return (
    <div className="rounded-xl border border-line/70 bg-card/60 p-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.09em] text-frost2">{label}</p>
      <p className={`mt-1.5 text-2xl font-bold tracking-tight ${toneClass}`}>{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-muted">{sub}</p>}
    </div>
  );
}

export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line/60 bg-ink/40 p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-[12px] font-bold uppercase tracking-[0.1em] text-frost">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export type Grade = 'A' | 'B' | 'C' | 'D';

const GRADE_TONE: Record<Grade, string> = {
  A: 'border-edge/25 bg-edge/10 text-edge',
  B: 'border-sky2/25 bg-sky2/10 text-sky2',
  C: 'border-warn/25 bg-warn/10 text-warn',
  D: 'border-danger/25 bg-danger/10 text-danger',
};

export function GradePill({ grade, confidence }: { grade: Grade | null; confidence?: number | null }) {
  if (!grade) {
    return <span className="rounded-full border border-line bg-panel2 px-2 py-0.5 font-mono text-[10px] text-frost2">unscored</span>;
  }
  return (
    <span className={`rounded-full border px-2 py-0.5 font-mono text-[10px] font-bold ${GRADE_TONE[grade]}`}>
      {grade}
      {confidence != null ? ` · ${confidence}%` : ''}
    </span>
  );
}

/** Horizontal probability bar — model probability vs implied (market) probability. */
export function ProbabilityBar({ modelPct, impliedPct }: { modelPct: number; impliedPct: number | null }) {
  const clamped = Math.max(0, Math.min(100, modelPct));
  const implied = impliedPct != null ? Math.max(0, Math.min(100, impliedPct)) : null;
  return (
    <div className="w-full">
      <div className="relative h-2 overflow-hidden rounded-full bg-panel2">
        <div className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-edge2 to-edge" style={{ width: `${clamped}%` }} />
        {implied != null && (
          <div
            className="absolute inset-y-0 w-0.5 bg-frost"
            style={{ left: `calc(${implied}% - 1px)` }}
            title={`Implied ${implied.toFixed(1)}%`}
          />
        )}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[9px] text-frost2">
        <span>model {modelPct.toFixed(1)}%</span>
        {implied != null && <span>implied {implied.toFixed(1)}%</span>}
      </div>
    </div>
  );
}

export function EmptyHint({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-line/50 bg-panel/40 px-3 py-3 text-center text-[11px] leading-relaxed text-frost2">
      {children}
    </p>
  );
}

/** Sport tag chip with per-league accent color. */
const SPORT_TONE: Record<string, string> = {
  MLB: 'border-sky2/30 bg-sky2/10 text-sky2',
  NFL: 'border-warn/30 bg-warn/10 text-warn',
  NBA: 'border-danger/30 bg-danger/10 text-danger',
  NHL: 'border-aqua/30 bg-aqua/10 text-aqua',
};

export function SportTag({ sport }: { sport: string }) {
  const cls = SPORT_TONE[sport.toUpperCase()] ?? 'border-line bg-panel2 text-frost2';
  return (
    <span className={`rounded-md border px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wide ${cls}`}>
      {sport.toUpperCase()}
    </span>
  );
}
