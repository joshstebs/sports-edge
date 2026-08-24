import { useEffect, useState } from 'react';
import { fetchPerformance, type PerformanceSummary } from '../lib/api';
import { EmptyHint, Section, Skeleton, Stat } from './ui/primitives';

function pct(value: number | null, places = 1): string {
  return value == null ? '—' : `${value.toFixed(places)}%`;
}

/**
 * Customer-facing Results page. Deliberately excludes provider/ops detail —
 * that lives in the admin-only Model Lab. Every number comes straight from
 * /api/predictions/performance; nothing is computed or padded here.
 */
export default function Results() {
  const [data, setData] = useState<PerformanceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchPerformance()
      .then((payload) => { if (!cancelled) { setData(payload.performance); setError(null); } })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load results.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const overall = data?.overall;
  const calibration = data?.insights.calibration;
  const clv = data?.insights.clv;
  const graded = overall?.graded ?? 0;
  const enoughForCharts = graded >= 10;

  return (
    <div className="mx-auto w-full max-w-5xl px-3 py-4 pb-24 sm:px-5 md:pb-8">
      <header className="mb-4">
        <h2 className="text-lg font-bold tracking-tight text-head">Results</h2>
        <p className="mt-0.5 max-w-2xl text-[11px] leading-relaxed text-muted">
          Outcomes are settled independently against real game results — never by the model that made the pick.
        </p>
      </header>

      {loading && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[86px]" />)}
          </div>
          <Skeleton className="h-40 w-full" />
        </div>
      )}

      {error && !loading && (
        <div className="rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger" role="alert">{error}</div>
      )}

      {data && !loading && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            <Stat
              label="Record"
              value={graded > 0 ? `${overall!.wins}–${overall!.losses}${overall!.pushes ? `–${overall!.pushes}` : ''}` : '—'}
              sub={`${graded} graded`}
            />
            <Stat label="Win rate" value={pct(overall?.winRate ?? null)} />
            <Stat
              label="ROI"
              value={overall?.roiPct != null ? `${overall.roiPct > 0 ? '+' : ''}${overall.roiPct.toFixed(1)}%` : '—'}
              tone={overall?.roiPct != null ? (overall.roiPct >= 0 ? 'positive' : 'negative') : 'default'}
              sub={overall?.units != null ? `${overall.units.toFixed(2)} units` : undefined}
            />
            <Stat
              label="Avg CLV"
              value={clv?.averagePriceEdgePct != null ? `${clv.averagePriceEdgePct > 0 ? '+' : ''}${clv.averagePriceEdgePct.toFixed(2)}%` : '—'}
              sub={clv?.tracked != null ? `${clv.tracked} legs tracked` : undefined}
            />
          </div>

          <Section title="Calibration, in plain language">
            {calibration && calibration.status !== 'insufficient-data' ? (
              <>
                <p className="text-[12px] leading-relaxed text-frost2">
                  When SportsEdge assigns roughly{' '}
                  <span className="font-bold text-head">{Math.round(calibration.averageConfidence ?? 0)}% confidence</span>,
                  comparable historical picks have won approximately{' '}
                  <span className={`font-bold ${calibration.status === 'well-calibrated' ? 'text-edge' : 'text-warn'}`}>
                    {Math.round(calibration.hitRate ?? 0)}%
                  </span>{' '}
                  of the time.
                  {calibration.status === 'well-calibrated'
                    ? ' Confidence is tracking outcomes well.'
                    : calibration.status === 'overconfident'
                      ? ' The model is currently running overconfident.'
                      : ' The model is currently running underconfident.'}
                </p>
                <p className="mt-1.5 font-mono text-[10px] text-muted">based on {calibration.graded} graded picks · Brier {overall?.brierScore?.toFixed(3) ?? '—'}</p>
              </>
            ) : (
              <EmptyHint>
                Not enough graded picks yet to make an honest calibration claim. SportsEdge will not imply statistical significance before the sample supports it.
              </EmptyHint>
            )}
          </Section>

          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="By Sport">
              {data.bySport.length === 0 ? (
                <EmptyHint>No graded picks yet.</EmptyHint>
              ) : (
                <BarList rows={data.bySport.map((r) => ({ key: r.sport, n: r.graded, winRate: r.winRate, roi: r.roiPct }))} showRoi={enoughForCharts} />
              )}
            </Section>

            <Section title="By Market">
              {data.byMarket.length === 0 ? (
                <EmptyHint>No graded picks yet.</EmptyHint>
              ) : (
                <BarList rows={data.byMarket.map((r) => ({ key: r.market, n: r.graded, winRate: r.winRate, roi: r.roiPct }))} showRoi={enoughForCharts} />
              )}
            </Section>
          </div>

          {data.byConfidence.length > 0 && (
            <Section title="By Confidence Band">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[12px]">
                  <thead className="text-[10px] uppercase tracking-wide text-frost2">
                    <tr><th className="py-2 pr-3">Band</th><th className="pr-3">n</th><th className="pr-3">Win rate</th><th>ROI</th></tr>
                  </thead>
                  <tbody>
                    {data.byConfidence.map((band) => (
                      <tr key={band.band} className="border-t border-line/50">
                        <td className="py-2.5 pr-3 font-semibold text-head">{band.band} <span className="font-mono text-[10px] text-frost2">({band.range})</span></td>
                        <td className="pr-3 font-mono">{band.n}</td>
                        <td className="pr-3 font-mono">{pct(band.hitRate)}</td>
                        <td className={`font-mono ${(band.netUnits ?? 0) >= 0 ? 'text-edge' : 'text-danger'}`}>{band.netUnits != null ? `${band.netUnits > 0 ? '+' : ''}${band.netUnits.toFixed(2)} u` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!enoughForCharts && (
                <p className="mt-2 text-[10px] text-frost2/70">Small sample — treat these breakdowns as a work in progress, not a verdict.</p>
              )}
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

function BarList({ rows, showRoi }: {
  rows: Array<{ key: string; n: number; winRate: number | null; roi: number | null }>;
  showRoi: boolean;
}) {
  return (
    <ul className="space-y-2.5">
      {rows.map((row) => (
        <li key={row.key}>
          <div className="mb-1 flex items-center justify-between text-[11px]">
            <span className="font-medium text-frost">{row.key} <span className="font-mono text-[9px] text-frost2">· {row.n}</span></span>
            <span className="font-mono text-head">{pct(row.winRate)}{showRoi && row.roi != null ? ` · ROI ${row.roi > 0 ? '+' : ''}${row.roi.toFixed(1)}%` : ''}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-panel2">
            <div
              className="h-full rounded-full bg-gradient-to-r from-edge2 to-edge"
              style={{ width: `${Math.min(100, Math.max(2, row.winRate ?? 0))}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
