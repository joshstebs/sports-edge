import { useEffect, useMemo, useState } from 'react';
import {
  fetchPerformance,
  type PerformanceSummary,
  type TopEdgePick,
} from '../lib/api';
import { formatAmerican } from '../lib/odds';
import BestBets, { addKeyFor } from './BestBets';
import { EmptyHint, GradePill, Section, Skeleton, SportTag, Stat } from './ui/primitives';
import type { View } from '../lib/nav';
import type { SgpLeg } from '../types';

interface TodayProps {
  onAsk: (text: string) => void;
  onAddLeg: (pick: TopEdgePick) => void;
  onNavigate: (view: View) => void;
  slipLegs: SgpLeg[];
}

function todayLabel(): string {
  return new Intl.DateTimeFormat('en-CA', {
    weekday: 'long', month: 'long', day: 'numeric', timeZone: 'America/Toronto',
  }).format(new Date());
}

export default function Today({ onAsk, onAddLeg, onNavigate, slipLegs }: TodayProps) {
  const slipCount = slipLegs.length;
  const [data, setData] = useState<PerformanceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchPerformance()
      .then((payload) => { if (!cancelled) { setData(payload.performance); setError(null); } })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load today’s data.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const recent = data?.recent ?? [];
  const overall = data?.overall;
  const last7 = data?.last7;
  const calibration = data?.insights.calibration;
  const clv = data?.insights.clv;

  const quickAsk = useMemo(
    () => [
      'Best bets today',
      'Build a 5-leg parlay',
      'Best MLB props',
      'Best NFL bets',
      'Best NBA props',
      'Best NHL bets',
    ],
    [],
  );

  return (
    <div className="mx-auto w-full max-w-5xl px-3 py-4 pb-24 sm:px-5 md:pb-8">
      <header className="desk-heading mb-5">
        <p className="font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-frost2">{todayLabel()}</p>
        <h2 className="mt-2 text-3xl font-bold tracking-tight text-head">Find your edge.<br/><span className="text-edge">Keep the receipts.</span></h2>
        <p className="mt-0.5 max-w-2xl text-[12px] leading-relaxed text-muted">
          Research the player, challenge the price and track the result. One workspace from first question to final whistle.
        </p>
        <div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={() => onNavigate('research')} className="min-h-11 rounded-lg bg-edge px-4 text-xs font-bold text-ink">Research a prop</button><button type="button" onClick={() => onNavigate('best-bets')} className="min-h-11 rounded-lg border border-line px-4 text-xs font-semibold text-head">Open Edge Desk →</button><button type="button" onClick={() => onNavigate('my-picks')} className="min-h-11 rounded-lg border border-line px-4 text-xs font-semibold text-head">Your tracked picks</button></div>
      </header>

      {/* Ask input */}
      <button
        type="button"
        onClick={() => onAsk('')}
        className="group mb-5 flex w-full items-center gap-3 rounded-xl border border-line bg-panel/70 px-4 py-3.5 text-left transition-colors hover:border-edge/40 hover:bg-panel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-edge/40"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-edge" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 17l5-5 4 3 6-8" /><path d="M14 7h4v4" />
        </svg>
        <span className="min-w-0 flex-1 truncate text-[13px] text-frost2 group-hover:text-frost">
          Ask about a matchup, prop, parlay or screenshot…
        </span>
        <kbd className="hidden rounded border border-line bg-panel2 px-1.5 py-0.5 font-mono text-[9px] text-frost2 sm:block">ASK</kbd>
      </button>

      {/* Quick actions */}
      <div className="mb-5 flex flex-wrap gap-2">
        {quickAsk.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => onAsk(q)}
            className="min-h-9 rounded-full border border-line bg-panel/60 px-3.5 text-[11px] font-semibold text-frost transition-colors hover:border-edge/40 hover:text-head focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-edge/40"
          >
            {q}
          </button>
        ))}
      </div>

      {/* Model snapshot */}
      {loading ? (
        <div className="mb-5 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[86px]" />)}
        </div>
      ) : error ? (
        <div className="mb-5 rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger" role="alert">{error}</div>
      ) : (
        <>
          <Section
            title="Model Snapshot"
            action={<span className="font-mono text-[10px] text-frost2">{data?.storage.durable ? 'durable ledger' : 'volatile store'}</span>}
          >
            <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
              <Stat
                label="Overall record"
                value={overall && overall.graded > 0 ? `${overall.wins}–${overall.losses}${overall.pushes ? `–${overall.pushes}` : ''}` : '—'}
                sub={overall?.graded ? `${overall.graded} graded picks` : 'no graded picks yet'}
              />
              <Stat label="Win rate" value={overall?.winRate != null ? `${overall.winRate.toFixed(1)}%` : '—'} sub={`7d ${last7?.winRate != null ? `${last7.winRate.toFixed(1)}%` : '—'} · 30d ${data?.last30?.winRate != null ? `${data.last30.winRate.toFixed(1)}%` : '—'}`} />
              <Stat
                label="ROI"
                value={overall?.roiPct != null ? `${overall.roiPct > 0 ? '+' : ''}${overall.roiPct.toFixed(1)}%` : '—'}
                sub={overall?.units != null ? `${overall.units.toFixed(2)} units` : undefined}
                tone={overall?.roiPct != null ? (overall.roiPct >= 0 ? 'positive' : 'negative') : 'default'}
              />
              <Stat
                label="CLV"
                value={clv?.averagePriceEdgePct != null ? `${clv.averagePriceEdgePct > 0 ? '+' : ''}${clv.averagePriceEdgePct.toFixed(2)}%` : '—'}
                sub={clv?.coveragePct != null ? `${clv.coveragePct.toFixed(0)}% priced coverage` : 'awaiting closing lines'}
              />
            </div>
            {calibration && (
              <p className="mt-3 text-[11px] leading-relaxed text-frost2">
                <span className="font-semibold text-frost">Calibration:</span>{' '}
                {calibration.status === 'well-calibrated' && `Well calibrated — when the model says ~${Math.round(calibration.averageConfidence ?? 0)}%, comparable historical picks won ~${Math.round(calibration.hitRate ?? 0)}% of the time.`}
                {calibration.status === 'overconfident' && 'Recent winners are running below stated confidence — the model is running overconfident.'}
                {calibration.status === 'underconfident' && 'Recent winners are beating stated confidence — the model is running underconfident.'}
                {calibration.status === 'insufficient-data' && 'Not enough graded picks yet to state calibration honestly. No claim is made.'}
                {' '}<span className="text-muted">(n={calibration.graded})</span>
              </p>
            )}
          </Section>

          {/* Top edges */}
          <div className="mt-4">
            <BestBets
              performance={data}
              loading={false}
              error={null}
              onAddLeg={onAddLeg}
              slipLegs={slipLegs}
              onResearch={() => onNavigate('research')}
            />
          </div>

          {/* Recent results */}
          <div className="mt-4">
            <Section title="Recent Results">
              {recent.length === 0 ? (
                <EmptyHint>No graded predictions yet. Results appear after games settle independently.</EmptyHint>
              ) : (
                <ul className="space-y-2">
                  {recent.slice(0, 6).map((r) => {
                    const won = r.outcome === 'won';
                    const lost = r.outcome === 'lost';
                    return (
                      <li key={r.predictionId + r.selection} className="flex items-center justify-between gap-3 rounded-lg border border-line/50 bg-panel/40 px-3 py-2.5">
                        <div className="min-w-0">
                          <div className="mb-0.5 flex items-center gap-2"><SportTag sport={r.sport} /></div>
                          <p className="truncate text-[12px] font-semibold text-head">{r.selection}</p>
                          <p className="truncate text-[10px] text-muted">{r.matchup}</p>
                        </div>
                        <span
                          className={`shrink-0 rounded-full px-2.5 py-1 font-mono text-[10px] font-bold uppercase ${
                            won ? 'bg-edge/15 text-edge' : lost ? 'bg-danger/15 text-danger' : 'bg-panel2 text-frost2'
                          }`}
                        >
                          {r.outcome || 'pending'}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Section>
          </div>

          {/* Active slip summary */}
          <div className="mt-4">
            <Section title="Active Slip">
              {slipCount === 0 ? (
                <EmptyHint>Your slip is empty. Add qualifying picks from Best Bets or an Ask session.</EmptyHint>
              ) : (
                <p className="text-[12px] text-frost2">
                  <span className="font-mono font-bold text-edge">{slipCount}</span> leg{slipCount === 1 ? '' : 's'} selected.
                  Open the <button type="button" className="text-edge underline-offset-2 hover:underline" onClick={() => onNavigate('parlays')}>Parlays</button> view to manage.
                </p>
              )}
            </Section>
          </div>
        </>
      )}

      {loading && (
        <div className="mt-4 space-y-3">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      )}
    </div>
  );
}

// Re-export for App to build slip legs consistently with BestBets page.
export { addKeyFor, formatAmerican, GradePill };
