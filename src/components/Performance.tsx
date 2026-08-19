import { useEffect, useState } from 'react';
import {
  downloadPredictionCsv,
  fetchDiagnostics,
  fetchPerformance,
  type DiagnosticsSnapshot,
  type PerformanceSummary,
  type SportInfo,
} from '../lib/api';
import { formatAmerican } from '../lib/odds';
import type { Sport } from '../types';

interface Props {
  onBack: () => void;
  onSelectSport: (s: Sport) => void;
}

function pct(value: number | null, places = 1): string {
  return value == null ? '—' : `${value.toFixed(places)}%`;
}
function signedPct(value: number | null, places = 1): string {
  if (value == null) return '—';
  return `${value > 0 ? '+' : ''}${value.toFixed(places)}%`;
}
function num(value: number | null): string {
  return value == null ? '—' : value.toFixed(2);
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-line/70 bg-card/60 p-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.09em] text-frost2">{label}</p>
      <p className="mt-1.5 text-2xl font-bold tracking-tight text-head">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-muted">{sub}</p>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line/60 bg-ink/40 p-4 sm:p-5">
      <h3 className="mb-3 text-[12px] font-bold uppercase tracking-[0.1em] text-frost">{title}</h3>
      {children}
    </section>
  );
}

function StatusPill({ status }: { status: 'ready' | 'fallback' | 'unavailable' }) {
  const cls = status === 'ready' ? 'bg-edge/10 text-edge'
    : status === 'fallback' ? 'bg-warn/10 text-warn' : 'bg-danger/10 text-danger';
  return <span className={`rounded-full px-2 py-1 text-[9px] font-bold uppercase tracking-wide ${cls}`}>{status}</span>;
}

function CalibrationBadge({ status }: { status: PerformanceSummary['insights']['calibration']['status'] }) {
  const label = status === 'well-calibrated' ? 'Well calibrated'
    : status === 'overconfident' ? 'Overconfident'
      : status === 'underconfident' ? 'Underconfident' : 'Building sample';
  const cls = status === 'well-calibrated' ? 'bg-edge/10 text-edge'
    : status === 'insufficient-data' ? 'bg-panel2 text-frost2' : 'bg-warn/10 text-warn';
  return <span className={`rounded-full px-2 py-1 text-[9px] font-bold uppercase tracking-wide ${cls}`}>{label}</span>;
}

function quotaText(value: unknown): string {
  if (value == null) return '—';
  if (typeof value === 'number' || typeof value === 'string') return String(value);
  try { return JSON.stringify(value); } catch { return '—'; }
}

export default function PerformancePage({ onBack, onSelectSport }: Props) {
  const [data, setData] = useState<{ performance: PerformanceSummary; sports: SportInfo[] } | null>(null);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([fetchPerformance(), fetchDiagnostics()])
      .then(([performance, ops]) => {
        if (cancelled) return;
        setData(performance);
        setDiagnostics(ops);
        setError(null);
      })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const exportCsv = async () => {
    setExporting(true);
    try { await downloadPredictionCsv(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Export failed'); }
    finally { setExporting(false); }
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-3 py-4 sm:px-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <button type="button" onClick={onBack} className="mb-1 text-[11px] font-medium text-frost2 hover:text-frost">← Back to chat</button>
          <h2 className="text-lg font-bold tracking-tight text-head">Model Performance & Operations</h2>
          <p className="text-[11px] text-muted">Accuracy, market edge, source health, fallbacks and learning diagnostics.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void exportCsv()}
            disabled={exporting}
            className="rounded-lg border border-line bg-panel px-3 py-2 text-[11px] font-semibold text-frost hover:bg-panel2 disabled:opacity-50"
          >
            {exporting ? 'Exporting…' : 'Export CSV'}
          </button>
          <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${data?.performance.storage.durable ? 'bg-edge/10 text-edge' : 'bg-warn/10 text-warn'}`}>
            {data?.performance.storage.durable ? 'Durable storage' : 'Volatile storage'}
          </span>
        </div>
      </div>

      {loading && <div className="h-40 animate-pulse rounded-2xl border border-line/60 bg-panel2/40" />}
      {error && <div className="mb-4 rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger">{error}</div>}

      {data && diagnostics && !loading && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Graded" value={String(data.performance.overall.graded)} sub={`${data.performance.overall.wins}W · ${data.performance.overall.losses}L · ${data.performance.overall.pushes}P`} />
            <Stat label="Win Rate" value={pct(data.performance.overall.winRate)} sub={`Brier ${num(data.performance.overall.brierScore)}`} />
            <Stat label="ROI" value={pct(data.performance.overall.roiPct)} sub={`${num(data.performance.overall.units)} units`} />
            <Stat label="CLV Coverage" value={pct(data.performance.insights.clv.coveragePct)} sub={`${data.performance.insights.clv.tracked}/${data.performance.insights.clv.eligiblePriced} priced legs`} />
          </div>

          <Section title="Today's Top Edges">
            <p className="mb-3 text-[11px] text-muted">Only real stored recommendations are shown. Market edge appears only when a verified sportsbook price exists.</p>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[12px]">
                <thead className="text-[10px] uppercase tracking-wide text-frost2"><tr><th className="py-2 pr-3">Pick</th><th className="pr-3">Confidence</th><th className="pr-3">Price</th><th className="pr-3">Edge</th><th>Source</th></tr></thead>
                <tbody>
                  {data.performance.insights.topEdges.length === 0 && <tr><td colSpan={5} className="py-4 text-muted">No qualifying pending edges stored for today.</td></tr>}
                  {data.performance.insights.topEdges.map((pick) => (
                    <tr key={`${pick.predictionId}-${pick.selection}`} className="border-t border-line/50 align-top">
                      <td className="py-2.5 pr-3"><p className="font-semibold text-head">{pick.selection}</p><p className="text-[10px] text-muted">{pick.sport} · {pick.matchup}</p></td>
                      <td className="pr-3 font-mono text-edge">{pick.confidence.toFixed(1)}%</td>
                      <td className="pr-3 font-mono">{pick.odds == null ? 'N/A' : formatAmerican(pick.odds)}</td>
                      <td className="pr-3 font-mono">{pick.edgePct == null ? 'Unpriced' : signedPct(pick.edgePct)}</td>
                      <td className="max-w-[220px] text-[10px] text-muted">{pick.source ?? pick.model}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="Calibration & Drift">
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-[11px] text-muted">Does stated confidence match verified outcomes?</p>
                <CalibrationBadge status={data.performance.insights.calibration.status} />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <Stat label="Avg confidence" value={pct(data.performance.insights.calibration.averageConfidence)} />
                <Stat label="Hit rate" value={pct(data.performance.insights.calibration.hitRate)} />
                <Stat label="Gap" value={signedPct(data.performance.insights.calibration.gapPct)} />
              </div>
              <div className="mt-3 space-y-2">
                {diagnostics.driftAlerts.map((alert, i) => (
                  <div key={`${alert.scope}-${i}`} className={`rounded-lg border p-2.5 text-[11px] ${alert.severity === 'critical' ? 'border-danger/30 bg-danger/5 text-danger' : alert.severity === 'warning' ? 'border-warn/30 bg-warn/5 text-warn' : 'border-line bg-panel/50 text-frost2'}`}>
                    <span className="font-semibold">{alert.scope}</span> · {alert.message}{alert.sampleSize ? ` (n=${alert.sampleSize})` : ''}
                  </div>
                ))}
              </div>
            </Section>

            <Section title="Closing Line Value">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2 xl:grid-cols-4">
                <Stat label="Coverage" value={pct(data.performance.insights.clv.coveragePct)} />
                <Stat label="Avg CLV" value={signedPct(data.performance.insights.clv.averagePriceEdgePct, 2)} />
                <Stat label="Implied move" value={signedPct(data.performance.insights.clv.averageImpliedMovePct, 2)} />
                <Stat label="Positive" value={String(data.performance.insights.clv.positiveClv)} sub={`${data.performance.insights.clv.negativeClv} negative`} />
              </div>
              <p className="mt-3 text-[10px] text-muted">{data.performance.insights.clv.note}</p>
            </Section>
          </div>

          <Section title="Provider Health & Fallbacks">
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {diagnostics.providers.map((provider) => (
                <div key={provider.id} className="rounded-xl border border-line/60 bg-card/50 p-3">
                  <div className="flex items-center justify-between gap-2"><p className="font-semibold text-head">{provider.label}</p><StatusPill status={provider.status} /></div>
                  <p className="mt-1 text-[10px] text-muted">{provider.source}</p>
                  <p className="mt-2 text-[11px] leading-relaxed text-frost2">{provider.note}</p>
                  <div className="mt-2 space-y-1 text-[10px] text-muted">
                    <p><span className="text-frost2">Primary:</span> {provider.primaryFor.join(', ')}</p>
                    <p><span className="text-frost2">Fallback:</span> {provider.fallback ?? 'none'}</p>
                    <p><span className="text-frost2">Cache:</span> {provider.cacheTtl}</p>
                    {provider.quota != null && <p className="truncate" title={quotaText(provider.quota)}><span className="text-frost2">Quota:</span> {quotaText(provider.quota)}</p>}
                  </div>
                </div>
              ))}
            </div>
          </Section>

          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="Operations">
              <div className="space-y-2 text-[11px]">
                <p><span className="font-semibold text-frost">LLM:</span> {diagnostics.llm.configured ? `${diagnostics.llm.provider ?? 'configured'} · ${diagnostics.llm.model ?? 'model'}` : 'not configured'}</p>
                <p><span className="font-semibold text-frost">Daily evaluation:</span> {diagnostics.cron.configured ? `${diagnostics.cron.schedule} ${diagnostics.cron.timezone}` : 'CRON_SECRET not configured'}</p>
                <p><span className="font-semibold text-frost">Storage:</span> {diagnostics.storage.backend} · {diagnostics.storage.durable ? 'durable' : 'not durable'}</p>
                <p><span className="font-semibold text-frost">Snapshot:</span> {new Date(diagnostics.generatedAt).toLocaleString()}</p>
              </div>
            </Section>
            <Section title="Cache Policy">
              <div className="space-y-2">
                {diagnostics.cachePolicy.map((row) => <div key={row.data} className="text-[11px]"><p className="font-semibold text-frost">{row.data} · {row.ttl}</p><p className="text-muted">{row.rationale}</p></div>)}
              </div>
            </Section>
          </div>

          <Section title="Source Routing">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {Object.entries(diagnostics.sourcePolicy).map(([sport, chain]) => (
                <button key={sport} type="button" onClick={() => onSelectSport(sport === 'odds' ? 'All' : sport as Sport)} className="rounded-xl border border-line/60 bg-card/50 p-3 text-left hover:bg-card">
                  <p className="font-semibold text-head">{sport}</p>
                  <p className="mt-1 text-[10px] leading-relaxed text-muted">{chain.join(' → ')}</p>
                </button>
              ))}
            </div>
          </Section>

          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="Performance by Sport">
              <div className="space-y-2">{data.performance.bySport.map((row) => <div key={row.sport} className="flex justify-between border-b border-line/40 pb-2 text-[12px]"><span className="text-frost">{row.sport} · {row.graded} graded</span><span className="font-mono text-head">{pct(row.winRate)} · ROI {pct(row.roiPct)}</span></div>)}</div>
            </Section>
            <Section title="Performance by Market">
              <div className="space-y-2">{data.performance.byMarket.map((row) => <div key={row.market} className="flex justify-between border-b border-line/40 pb-2 text-[12px]"><span className="text-frost">{row.market} · {row.graded}</span><span className="font-mono text-head">{pct(row.winRate)} · ROI {pct(row.roiPct)}</span></div>)}</div>
            </Section>
          </div>

          <Section title="Model Versions">
            <div className="overflow-x-auto"><table className="w-full text-left text-[12px]"><thead className="text-[10px] uppercase text-frost2"><tr><th className="py-2">Model</th><th>Graded</th><th>Win %</th><th>ROI</th></tr></thead><tbody>{data.performance.models.map((m) => <tr key={m.model} className="border-t border-line/50"><td className="py-2 font-mono">{m.model}</td><td>{m.graded}</td><td>{pct(m.winRate)}</td><td>{pct(m.roiPct)}</td></tr>)}</tbody></table></div>
          </Section>
        </div>
      )}
    </div>
  );
}
