import { useEffect, useState } from 'react';
import { fetchPerformance, type PerformanceSummary, type SportInfo } from '../lib/api';
import type { Sport } from '../types';

interface Props {
  onBack: () => void;
  onSelectSport: (s: Sport) => void;
}

function pct(value: number | null): string {
  return value == null ? '—' : `${value.toFixed(1)}%`;
}
function num(value: number | null): string {
  return value == null ? '—' : value.toFixed(2);
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-line/70 bg-card/60 p-4">
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-frost2">{label}</p>
      <p className="mt-1.5 text-2xl font-bold tracking-tight text-head">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-muted">{sub}</p>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line/60 bg-ink/40 p-4 sm:p-5">
      <h3 className="mb-3 text-[13px] font-bold uppercase tracking-[0.1em] text-frost">{title}</h3>
      {children}
    </section>
  );
}

function BarRow({ label, value, max, tone }: { label: string; value: number | null; max: number; tone: string }) {
  const w = value == null ? 0 : Math.max(2, Math.min(100, (value / max) * 100));
  return (
    <div className="flex items-center gap-3 py-1.5">
      <span className="w-28 shrink-0 truncate text-[12px] text-frost2" title={label}>{label}</span>
      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-panel2">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${w}%` }} />
      </div>
      <span className="w-14 shrink-0 text-right font-mono text-[12px] text-head">{value == null ? '—' : value.toFixed(1)}%</span>
    </div>
  );
}

export default function PerformancePage({ onBack, onSelectSport }: Props) {
  const [data, setData] = useState<{ performance: PerformanceSummary; sports: SportInfo[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchPerformance()
      .then((d) => { if (!cancelled) { setData(d); setError(null); } })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="mx-auto w-full max-w-5xl px-3 py-4 sm:px-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <button type="button" onClick={onBack} className="mb-1 inline-flex items-center gap-1 text-[11px] font-medium text-frost2 hover:text-frost">
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
            Back to chat
          </button>
          <h2 className="text-lg font-bold tracking-tight text-head">Model Performance</h2>
          <p className="text-[11px] text-muted">
            {data ? `Generated ${new Date(data.performance.generatedAt).toLocaleString()}` : 'Self-auditing prediction record…'}
          </p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${data?.performance.storage.durable ? 'bg-edge/10 text-edge' : 'bg-warn/10 text-warn'}`}>
          {data?.performance.storage.durable ? 'Durable storage' : 'Volatile storage'}
        </span>
      </div>

      {loading && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl border border-line/60 bg-panel2/40" />
          ))}
        </div>
      )}

      {error && !loading && (
        <div className="rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger">{error}</div>
      )}

      {data && !loading && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Graded" value={String(data.performance.overall.graded)} sub={`${data.performance.overall.wins}W · ${data.performance.overall.losses}L · ${data.performance.overall.pushes}P`} />
            <Stat label="Win Rate" value={pct(data.performance.overall.winRate)} sub={`Brier ${num(data.performance.overall.brierScore)}`} />
            <Stat label="ROI" value={pct(data.performance.overall.roiPct)} sub={`${num(data.performance.overall.units)} units`} />
            <Stat label="Priced Legs" value={String(data.performance.overall.priced)} sub="with verified odds" />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="Last 7 Days">
              <BarRow label="Win rate" value={data.performance.last7.winRate} max={100} tone="bg-edge" />
              <BarRow label="ROI" value={data.performance.last7.roiPct} max={100} tone="bg-edge2" />
              <p className="mt-2 text-[11px] text-muted">{data.performance.last7.graded} graded legs in window</p>
            </Section>
            <Section title="Last 30 Days">
              <BarRow label="Win rate" value={data.performance.last30.winRate} max={100} tone="bg-edge" />
              <BarRow label="ROI" value={data.performance.last30.roiPct} max={100} tone="bg-edge2" />
              <p className="mt-2 text-[11px] text-muted">{data.performance.last30.graded} graded legs in window</p>
            </Section>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="Performance by Sport">
              {data.performance.bySport.length === 0 && <p className="text-[12px] text-muted">No graded legs yet.</p>}
              {data.performance.bySport.map((r) => (
                <BarRow key={r.sport} label={r.sport} value={r.winRate} max={100} tone="bg-edge" />
              ))}
            </Section>
            <Section title="Performance by Bet Type">
              {data.performance.byMarket.length === 0 && <p className="text-[12px] text-muted">No graded legs yet.</p>}
              {data.performance.byMarket.map((r) => (
                <BarRow key={r.market} label={r.market} value={r.winRate} max={100} tone="bg-edge2" />
              ))}
            </Section>
          </div>

          <Section title="Performance by Confidence Band">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[12px]">
                <thead className="text-[10px] uppercase tracking-wide text-frost2">
                  <tr>
                    <th className="py-1.5 pr-3 font-medium">Band</th>
                    <th className="py-1.5 pr-3 font-medium">Range</th>
                    <th className="py-1.5 pr-3 font-medium">N</th>
                    <th className="py-1.5 pr-3 font-medium">Win %</th>
                    <th className="py-1.5 font-medium">Units</th>
                  </tr>
                </thead>
                <tbody className="text-frost">
                  {data.performance.byConfidence.map((b) => (
                    <tr key={b.band} className="border-t border-line/50">
                      <td className="py-2 pr-3 font-semibold">{b.band}</td>
                      <td className="py-2 pr-3 text-muted">{b.range}</td>
                      <td className="py-2 pr-3 font-mono">{b.n}</td>
                      <td className="py-2 pr-3 font-mono">{pct(b.hitRate)}</td>
                      <td className="py-2 font-mono">{num(b.netUnits)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section title="Model Versions">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[12px]">
                <thead className="text-[10px] uppercase tracking-wide text-frost2">
                  <tr>
                    <th className="py-1.5 pr-3 font-medium">Model</th>
                    <th className="py-1.5 pr-3 font-medium">Graded</th>
                    <th className="py-1.5 pr-3 font-medium">Win %</th>
                    <th className="py-1.5 font-medium">ROI</th>
                  </tr>
                </thead>
                <tbody className="text-frost">
                  {data.performance.models.map((m) => (
                    <tr key={m.model} className="border-t border-line/50">
                      <td className="py-2 pr-3 font-mono">{m.model}</td>
                      <td className="py-2 pr-3 font-mono">{m.graded}</td>
                      <td className="py-2 pr-3 font-mono">{pct(m.winRate)}</td>
                      <td className="py-2 font-mono">{pct(m.roiPct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section title="League Coverage (Modular)">
            <div className="flex flex-wrap gap-2">
              {data.sports.map((s) => (
                <button
                  key={s.code}
                  type="button"
                  onClick={() => s.status === 'live' && onSelectSport(s.code as Sport)}
                  disabled={s.status !== 'live'}
                  className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                    s.status === 'live' ? 'border-line/70 bg-card/60 hover:border-edge/40 hover:bg-panel' : 'cursor-not-allowed border-line/40 bg-panel2/30 opacity-60'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold text-head">{s.name}</span>
                    {s.status === 'live'
                      ? <span className="h-1.5 w-1.5 rounded-full bg-edge" />
                      : <span className="rounded bg-panel2 px-1 text-[8px] uppercase text-frost2">soon</span>}
                  </div>
                  <p className="mt-0.5 max-w-[180px] text-[10px] text-muted">{s.inputs.slice(0, 3).join(' · ')}{s.inputs.length > 3 ? ' …' : ''}</p>
                </button>
              ))}
            </div>
          </Section>

          <Section title="Recent Graded Predictions">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[12px]">
                <thead className="text-[10px] uppercase tracking-wide text-frost2">
                  <tr>
                    <th className="py-1.5 pr-3 font-medium">Graded</th>
                    <th className="py-1.5 pr-3 font-medium">Sport</th>
                    <th className="py-1.5 pr-3 font-medium">Matchup</th>
                    <th className="py-1.5 pr-3 font-medium">Selection</th>
                    <th className="py-1.5 font-medium">Result</th>
                  </tr>
                </thead>
                <tbody className="text-frost">
                  {data.performance.recent.length === 0 && (
                    <tr><td colSpan={5} className="py-3 text-muted">No graded predictions yet. Generate picks and let games finish to populate this view.</td></tr>
                  )}
                  {data.performance.recent.map((r) => (
                    <tr key={r.predictionId + r.selection} className="border-t border-line/50">
                      <td className="py-2 pr-3 font-mono text-muted">{r.gradedAt ? new Date(r.gradedAt).toLocaleDateString() : '—'}</td>
                      <td className="py-2 pr-3 font-semibold">{r.sport}</td>
                      <td className="py-2 pr-3 max-w-[180px] truncate text-muted" title={r.matchup}>{r.matchup}</td>
                      <td className="py-2 pr-3 max-w-[200px] truncate" title={r.selection}>{r.selection}</td>
                      <td className="py-2">
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                          r.outcome === 'won' ? 'bg-edge/10 text-edge' : r.outcome === 'lost' ? 'bg-danger/10 text-danger' : 'bg-warn/10 text-warn'
                        }`}>{r.outcome}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <p className="text-[11px] text-muted">
            Calibration integrity: model probabilities are never overwritten by the language model. Adjustments use shrinkage on samples ≥20 and require historical validation (see adaptive rules in the evaluation log).
          </p>
        </div>
      )}
    </div>
  );
}
