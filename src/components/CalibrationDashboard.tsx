import { useEffect, useState } from 'react';
import { fetchCalibration, type SportMarketCalibration, type CalibrationBucket } from '../lib/api';

const GRADE_STYLES: Record<'A' | 'B' | 'C' | 'D', string> = {
  A: 'bg-edge/15 text-edge ring-edge/40 shadow-[0_0_10px_rgba(21,255,194,0.18)]',
  B: 'bg-sky2/15 text-sky2 ring-sky2/40',
  C: 'bg-warn/15 text-warn ring-warn/40',
  D: 'bg-danger/15 text-danger ring-danger/40',
};

function calDir(calError: number): { label: string; color: string } {
  if (calError > 0.02) return { label: 'UNDER-confident', color: 'text-sky2' };
  if (calError < -0.02) return { label: 'OVER-confident', color: 'text-warn' };
  return { label: 'Well-calibrated', color: 'text-edge' };
}

function CalibrationBucketRow({ bucket }: { bucket: CalibrationBucket }) {
  const { label, color } = calDir(bucket.calibrationError);
  const grade = bucket.grade;
  const style = GRADE_STYLES[grade];

  return (
    <tr className="border-t border-line/30 hover:bg-panel/40 transition-colors">
      <td className="px-3 py-2 text-[11px] font-mono tabular-nums text-frost">{bucket.bucket}</td>
      <td className="px-3 py-2 text-[11px] text-frost">{bucket.sampleSize}</td>
      <td className="px-3 py-2 text-[11px] font-mono tabular-nums text-edge/80">
        {(bucket.winRate * 100).toFixed(1)}%
      </td>
      <td className="px-3 py-2 text-[11px] font-mono tabular-nums text-frost2">
        {(bucket.avgModelProb * 100).toFixed(1)}%
      </td>
      <td className="px-3 py-2 text-[11px] font-mono tabular-nums">
        <span className={color}>
          {(bucket.calibrationError * 100).toFixed(1)}pp
        </span>
        <span className={`ml-1 rounded-md px-1.5 py-0.5 text-[9px] font-bold ring-1 ${style}`}>
          {label}
        </span>
      </td>
      <td className="px-3 py-2 text-[11px] font-mono tabular-nums">
        <span className={bucket.brierScore < 0.25 ? 'text-edge' : bucket.brierScore < 0.3 ? 'text-warn' : 'text-danger'}>
          {bucket.brierScore.toFixed(4)}
        </span>
      </td>
      <td className="px-3 py-2 text-[11px] font-mono tabular-nums">
        <span className={bucket.roi >= 0 ? 'text-edge' : 'text-danger'}>
          {bucket.roi >= 0 ? '+' : ''}{bucket.roi.toFixed(1)}%
        </span>
      </td>
      <td className="px-3 py-2 text-[11px] font-mono tabular-nums text-sky2">
        {bucket.clvBeatRate.toFixed(1)}%
      </td>
      <td className="px-3 py-2 text-[11px] font-mono tabular-nums text-aqua">
        {bucket.avgClvPercent.toFixed(1)}%
      </td>
      <td className="px-3 py-2">
        <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-bold ring-1 ${style}`}>
          {grade}
        </span>
      </td>
    </tr>
  );
}

function SportMarketCard({ calibration }: { calibration: SportMarketCalibration }) {
  const { sport, market, overall, buckets } = calibration;
  const displayBuckets = buckets.filter(b => b.sampleSize >= 10);

  return (
    <div className="rounded-xl border border-line/70 bg-panel/80 overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-line/50 bg-panel2/50 px-4 py-2.5">
        <span className="rounded-full bg-edge/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-edge ring-1 ring-edge/25">
          {sport.toUpperCase()}
        </span>
        <span className="rounded-full border border-line/50 bg-ink/40 px-2 py-0.5 text-[10px] font-semibold text-frost capitalize">
          {market.replace(/_/g, ' ')}
        </span>
        <span className="ml-auto rounded-full border border-edge/20 bg-ink/60 px-2 py-0.5 text-[10px] font-bold tabular-nums text-frost">
          n={overall.totalSample}
        </span>
      </div>

      <div className="grid gap-3 p-4 grid-cols-4 sm:grid-cols-8">
        <StatCard label="Win Rate" value={(overall.overallWinRate * 100).toFixed(1)} unit="%" color="edge" />
        <StatCard label="Brier" value={overall.overallBrier.toFixed(4)} color="sky2" />
        <StatCard label="ROI" value={overall.overallRoi >= 0 ? `+${overall.overallRoi.toFixed(1)}` : overall.overallRoi.toFixed(1)} unit="%" color={overall.overallRoi >= 0 ? 'edge' : 'danger'} />
        <StatCard label="CLV Beat" value={overall.overallClvBeatRate.toFixed(1)} unit="%" color="sky2" />
        <StatCard label="Avg Cal Error" value={overall.avgCalibrationError >= 0 ? `+${(overall.avgCalibrationError * 100).toFixed(1)}` : (overall.avgCalibrationError * 100).toFixed(1)} unit="pp" color="warn" />
        <StatCard label="Avg CLV" value={overall.overallAvgClvPercent?.toFixed(1) ?? '—'} unit="%" color="aqua" />
      </div>

      {displayBuckets.length > 0 && (
        <div className="overflow-x-auto px-4 pb-4">
          <table className="w-full text-left text-[10px]">
            <thead>
              <tr className="text-frost2 uppercase tracking-wider">
                <th className="px-3 py-2">Bucket</th>
                <th className="px-3 py-2">n</th>
                <th className="px-3 py-2">Win %</th>
                <th className="px-3 py-2">Pred %</th>
                <th className="px-3 py-2">Cal Error</th>
                <th className="px-3 py-2">Brier</th>
                <th className="px-3 py-2">ROI</th>
                <th className="px-3 py-2">CLV Beat</th>
                <th className="px-3 py-2">Avg CLV</th>
                <th className="px-3 py-2">Grade</th>
              </tr>
            </thead>
            <tbody>
              {displayBuckets.map((b, i) => (
                <CalibrationBucketRow key={`${sport}-${market}-${i}`} bucket={b} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {displayBuckets.length === 0 && (
        <p className="px-4 pb-4 text-[11px] text-frost2">Insufficient evaluated samples for bucket breakdown (need ≥10 per bucket).</p>
      )}
    </div>
  );
}

function StatCard({ label, value, unit = '', color }: { label: string; value: string; unit?: string; color: string }) {
  const colorMap: Record<string, string> = {
    edge: 'text-edge',
    danger: 'text-danger',
    warn: 'text-warn',
    sky2: 'text-sky2',
    aqua: 'text-aqua',
    frost: 'text-frost',
  };
  return (
    <div className="rounded-lg border border-line/50 bg-panel2/60 p-3">
      <p className="text-[10px] text-frost2 uppercase tracking-wide">{label}</p>
      <p className={`mt-0.5 font-display text-lg font-bold tabular-nums ${colorMap[color] || 'text-frost'}`}>
        {value}
        <span className="text-[11px] font-normal text-frost2">{unit}</span>
      </p>
    </div>
  );
}

export default function CalibrationDashboard() {
  const [calibration, setCalibration] = useState<SportMarketCalibration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSport, setSelectedSport] = useState<string | undefined>();

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const res = await fetchCalibration(selectedSport);
        if (res.success) {
          setCalibration(res.calibration);
        } else {
          setError('Failed to load calibration data');
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [selectedSport]);

  const sports = [...new Set(calibration.map(c => c.sport))];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-frost2">
        <svg className="animate-spin h-6 w-6 text-edge" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
          <path d="M12 2a10 10 0 0110 10" strokeLinecap="round" />
        </svg>
        <span className="ml-3">Loading calibration data...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-danger/40 bg-danger/10 p-4 text-danger text-sm">
        Failed to load calibration: {error}
      </div>
    );
  }

  if (!calibration.length) {
    return (
      <div className="rounded-xl border border-line/50 bg-panel/80 p-8 text-center text-frost2">
        <svg className="mx-auto h-10 w-10 text-frost2/50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M9 11l3 3L22 4" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <p className="mt-3 font-medium">No calibration data available</p>
        <p className="mt-1 text-sm">Evaluated predictions with closing lines are needed to compute calibration.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-bold tracking-tight text-edge">Model Calibration Dashboard</h2>
          <p className="text-xs text-frost2">Probability calibration across sport/market pairs — {calibration.reduce((sum, c) => sum + c.overall.totalSample, 0)} total evaluated legs</p>
        </div>
        <select
          value={selectedSport || 'all'}
          onChange={e => setSelectedSport(e.target.value === 'all' ? undefined : e.target.value)}
          className="rounded-lg border border-line/50 bg-ink/60 px-3 py-1.5 text-sm font-semibold text-head focus:border-edge focus:outline-none"
        >
          <option value="all">All Sports</option>
          {sports.map(s => (
            <option key={s} value={s}>{s.toUpperCase()}</option>
          ))}
        </select>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line/50 bg-panel/80 p-3 text-[10px] text-frost2">
        <span className="font-semibold text-head">Grade Legend:</span>
        <span className="rounded-md px-1.5 py-0.5 font-bold ring-1 bg-edge/15 text-edge ring-edge/40">A {'>='} 70% win rate</span>
        <span className="rounded-md px-1.5 py-0.5 font-bold ring-1 bg-sky2/15 text-sky2 ring-sky2/40">B {'>='} 60%</span>
        <span className="rounded-md px-1.5 py-0.5 font-bold ring-1 bg-warn/15 text-warn ring-warn/40">C {'>='} 50%</span>
        <span className="rounded-md px-1.5 py-0.5 font-bold ring-1 bg-danger/15 text-danger ring-danger/40">D {'<'} 50%</span>
        <span className="ml-auto text-frost2/70">
          Cal Error {'>'} 0 = UNDER-confident (model too conservative) | {'<'} 0 = OVER-confident
        </span>
      </div>

      {/* Grid of sport/market cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {calibration.map(c => (
          <SportMarketCard key={`${c.sport}-${c.market}`} calibration={c} />
        ))}
      </div>
    </div>
  );
}