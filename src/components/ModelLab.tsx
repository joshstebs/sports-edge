import { useEffect, useState } from 'react';
import {
  downloadPredictionCsv,
  fetchDiagnostics,
  fetchPerformance,
  type DiagnosticsSnapshot,
  type PerformanceSummary,
} from '../lib/api';
import { Section, Stat } from './ui/primitives';

function StatusPill({ status }: { status: 'ready' | 'fallback' | 'unavailable' }) {
  const cls = status === 'ready' ? 'bg-edge/10 text-edge'
    : status === 'fallback' ? 'bg-warn/10 text-warn' : 'bg-danger/10 text-danger';
  return <span className={`rounded-full px-2 py-1 text-[9px] font-bold uppercase tracking-wide ${cls}`}>{status}</span>;
}

function quotaText(value: unknown): string {
  if (value == null) return '—';
  if (typeof value === 'number' || typeof value === 'string') return String(value);
  try { return JSON.stringify(value); } catch { return '—'; }
}

/**
 * Model Lab — ADMIN ONLY. Engineering operations detail (provider health,
 * fallbacks, quotas, cron, storage, drift) lives here instead of being mixed
 * into the customer-facing Results page. No secrets are exposed; the
 * diagnostics API intentionally reports configuration state, not credentials.
 */
export default function ModelLab() {
  const [data, setData] = useState<PerformanceSummary | null>(null);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchPerformance(), fetchDiagnostics()])
      .then(([performance, ops]) => {
        if (cancelled) return;
        setData(performance.performance);
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
    <div className="mx-auto w-full max-w-6xl px-3 py-4 pb-24 sm:px-5 md:pb-8">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold tracking-tight text-head">Model Lab</h2>
          <p className="text-[11px] text-muted">Operations &amp; diagnostics — admin only. Customer-facing results live in Results.</p>
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
          <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${diagnostics?.storage.durable ? 'bg-edge/10 text-edge' : 'bg-warn/10 text-warn'}`}>
            {diagnostics?.storage.durable ? 'Durable storage' : 'Volatile storage'}
          </span>
        </div>
      </div>

      {loading && <div className="h-40 animate-pulse rounded-2xl border border-line/60 bg-panel2/40" />}
      {error && !loading && (
        <div className="mb-4 rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger">{error}</div>
      )}

      {data && diagnostics && !loading && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Graded" value={String(data.overall.graded)} sub={`${data.overall.wins}W · ${data.overall.losses}L · ${data.overall.pushes}P`} />
            <Stat label="Brier score" value={data.overall.brierScore?.toFixed(3) ?? '—'} sub={`priced legs ${data.overall.priced}`} />
            <Stat label="CLV coverage" value={data.insights.clv.coveragePct != null ? `${data.insights.clv.coveragePct.toFixed(0)}%` : '—'} sub={`${data.insights.clv.tracked}/${data.insights.clv.eligiblePriced} priced`} />
            <Stat label="Calibration" value={data.insights.calibration.status === 'well-calibrated' ? 'OK' : data.insights.calibration.status === 'insufficient-data' ? 'n<min' : 'drift'} sub={`gap ${data.insights.calibration.gapPct != null ? `${data.insights.calibration.gapPct.toFixed(1)}%` : '—'}`} />
          </div>

          <Section title="Drift Alerts">
            {diagnostics.driftAlerts.length === 0 ? (
              <p className="text-[11px] text-muted">No drift alerts.</p>
            ) : (
              <div className="space-y-2">
                {diagnostics.driftAlerts.map((alert, i) => (
                  <div key={`${alert.scope}-${i}`} className={`rounded-lg border p-2.5 text-[11px] ${alert.severity === 'critical' ? 'border-danger/30 bg-danger/5 text-danger' : alert.severity === 'warning' ? 'border-warn/30 bg-warn/5 text-warn' : 'border-line bg-panel/50 text-frost2'}`}>
                    <span className="font-semibold">{alert.scope}</span> · {alert.message}{alert.sampleSize ? ` (n=${alert.sampleSize})` : ''}
                  </div>
                ))}
              </div>
            )}
          </Section>

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
                <p className="pt-1 text-[10px] text-frost2/70">Credentials and secrets are never included in diagnostics output.</p>
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
                <div key={sport} className="rounded-xl border border-line/60 bg-card/50 p-3">
                  <p className="font-semibold text-head">{sport}</p>
                  <p className="mt-1 text-[10px] leading-relaxed text-muted">{chain.join(' → ')}</p>
                </div>
              ))}
            </div>
          </Section>

          <Section title="Model Versions">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[12px]">
                <thead className="text-[10px] uppercase text-frost2">
                  <tr><th className="py-2">Model</th><th>Graded</th><th>Win %</th><th>ROI</th></tr>
                </thead>
                <tbody>
                  {data.models.map((m) => (
                    <tr key={m.model} className="border-t border-line/50">
                      <td className="py-2 font-mono">{m.model}</td>
                      <td>{m.graded}</td>
                      <td>{m.winRate != null ? `${m.winRate.toFixed(1)}%` : '—'}</td>
                      <td>{m.roiPct != null ? `${m.roiPct > 0 ? '+' : ''}${m.roiPct.toFixed(1)}%` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        </div>
      )}
    </div>
  );
}
