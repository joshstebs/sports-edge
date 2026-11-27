import { useEffect, useState } from 'react';
import type { PropLearningReport } from '../../server/src/workspace';
import { displayPropMarket } from '../lib/api';
import { formatAmerican } from '../lib/odds';

type Sport = 'nba' | 'mlb' | 'nfl' | 'nhl';
const MARKETS: Record<Sport, string[]> = {
  nba: ['points', 'rebounds', 'assists', 'threePointersMade', 'pointsReboundsAssists'],
  mlb: ['hits', 'totalBases', 'strikeouts', 'outsRecorded'],
  nfl: ['passingYards', 'passingTouchdowns', 'rushingYards', 'rushingAttempts', 'receivingYards', 'receptions', 'touchdowns'],
  nhl: ['shotsOnGoal', 'hockeyPoints', 'saves'],
};

type Scan = {
  reason: string | null;
  candidates: Array<{
    player: string; eventId: string; side: string; market: string; line: number;
    confidencePct: number; sampleSize: number; priced: boolean; odds: number | null; edgePct: number | null;
  }>;
};

const button = 'min-h-10 rounded-lg border border-line bg-panel2 px-3 text-sm font-semibold text-head hover:border-edge disabled:opacity-60';

async function request<T>(path: string, body?: object): Promise<T> {
  const response = await fetch(`${import.meta.env.BASE_URL}api/workspace/prop-learning${path}`, body ? {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  } : { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error('Player-prop analysis could not finish. Try again.');
  return response.json() as Promise<T>;
}

export default function PropLearningPanel() {
  const [report, setReport] = useState<PropLearningReport>();
  const [scan, setScan] = useState<Scan>();
  const [sport, setSport] = useState<Sport>('nba');
  const [market, setMarket] = useState('');
  const [busy, setBusy] = useState<'scan' | 'grade' | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let ignore = false;
    request<PropLearningReport>('')
      .then(value => { if (!ignore) setReport(value); })
      .catch((cause: Error) => { if (!ignore) setError(cause.message); });
    return () => { ignore = true; };
  }, []);

  async function run(action: 'scan' | 'grade') {
    setError('');
    setNotice('');
    setBusy(action);
    if (action === 'scan') setScan(undefined);
    try {
      if (action === 'scan') {
        const result = await request<{ report: PropLearningReport; scan: Scan }>('/scan', {
          sport, ...(market ? { market } : {}),
        });
        setReport(result.report);
        setScan(result.scan);
      } else {
        const result = await request<{ report: PropLearningReport; run: { graded: number } }>('/grade', {});
        setReport(result.report);
        setNotice(`${result.run.graded} candidate outcomes updated from game logs.`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Player-prop request failed.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="mb-4 space-y-4 rounded-xl border border-line bg-panel p-4" aria-labelledby="prop-learning-title">
      <div>
        <h3 id="prop-learning-title" className="text-lg font-semibold text-head">Player Prop Lab</h3>
        <p className="mt-1 text-sm text-frost2">Scan player props and see which probability adjustments improved on later games.</p>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-xs text-frost">
          Sport
          <select className={button} value={sport} disabled={busy !== null} onChange={event => {
            setSport(event.target.value as Sport); setMarket(''); setScan(undefined);
          }}>
            {Object.keys(MARKETS).map(key => <option key={key} value={key}>{key.toUpperCase()}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-xs text-frost">
          Market
          <select className={button} value={market} disabled={busy !== null} onChange={event => {
            setMarket(event.target.value); setScan(undefined);
          }}>
            <option value="">All supported markets</option>
            {MARKETS[sport].map(key => <option key={key} value={key}>{displayPropMarket(key)}</option>)}
          </select>
        </label>
        <button className={button} type="button" disabled={busy !== null} onClick={() => void run('scan')}>
          {busy === 'scan' ? 'Scanning…' : 'Scan slate'}
        </button>
        <button className={button} type="button" disabled={busy !== null} onClick={() => void run('grade')}>
          {busy === 'grade' ? 'Grading…' : 'Grade completed games'}
        </button>
      </div>

      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {notice && <p role="status" className="text-sm text-frost">{notice}</p>}
      {report && (
        <div className="space-y-2">
          <p className="text-sm text-frost">
            {report.tracked} pregame prices tracked · {report.settled} graded decisions · {report.trends.filter(row => row.active).length} active adjustments
          </p>
          {!report.trends.length && <p className="text-sm text-frost2">Learning begins once the same market and side have enough priced results across different game dates.</p>}
          {report.trends.length > 0 && (
            <ul className="divide-y divide-line rounded-lg border border-line">
              {report.trends.map(trend => (
                <li className="px-3 py-2 text-sm text-frost" key={`${trend.sport}:${trend.market}:${trend.side}:${trend.modelVersion}`}>
                  <span className="font-semibold text-head">{trend.sport.toUpperCase()} {displayPropMarket(trend.market)} {trend.side}</span>
                  <span className="ml-2">{trend.active ? `${(trend.adjustment * 100).toFixed(1)} pp adjustment` : 'Baseline retained'}</span>
                  <p className="text-xs text-frost2">Brier score {trend.baselineBrier.toFixed(3)} → {trend.adjustedBrier.toFixed(3)} across {trend.holdoutCount} later results. Lower is better.</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {scan && (
        <div className="space-y-2">
          {scan.reason && <p className="text-sm text-frost2">{scan.reason}</p>}
          {!scan.candidates.length && <p className="text-sm text-frost2">No candidates cleared the scan for this slate.</p>}
          <ul className="divide-y divide-line">
            {scan.candidates.map(row => (
              <li key={`${row.eventId}:${row.player}:${row.market}`} className="py-2 text-sm text-frost">
                <p className="font-semibold text-head">{row.player} · {displayPropMarket(row.market)} {row.side} {row.line}</p>
                <p className="text-xs text-frost2">
                  {row.confidencePct}% estimated · {row.sampleSize} games
                  {row.priced && row.odds != null
                    ? ` · ${formatAmerican(row.odds)} · ${row.edgePct} pp above break-even · Check availability`
                    : ' · Research only'}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
