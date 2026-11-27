import { useEffect, useState, type ReactNode } from 'react';
import type { Connector, LineMovement, WorkspaceSnapshot } from '../../server/src/workspace';
import type { View } from '../lib/nav';
import WorkspaceTracking from './WorkspaceTracking';

const button = 'min-h-10 rounded-lg border border-line px-3 text-sm font-semibold text-head hover:bg-panel2 focus-visible:outline-edge aria-pressed:border-edge aria-pressed:text-edge';
const panel = 'rounded-xl border border-line bg-panel p-5';

function ConnectorCard<T>({ title, value, children }: {
  title: string;
  value: Connector<T> | undefined;
  children: (data: T) => ReactNode;
}) {
  return (
    <section className={panel}>
      <h2 className="mb-3 text-sm font-semibold text-frost">{title}</h2>
      {value?.status === 'ready' ? children(value.data) : (
        <p className="text-sm text-frost2">{value ? connectorMessage(value.status, 'BetIQ') : 'Waiting for data…'}</p>
      )}
    </section>
  );
}

function connectorMessage(status: 'unconfigured' | 'unavailable', source: string) {
  return status === 'unconfigured' ? `Connect ${source} in the server settings.` : `${source} is unavailable. Try refreshing.`;
}

const formatNumber = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const formatTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const marketLabels: Record<string, string> = { h2h: 'Moneyline', spreads: 'Spread', totals: 'Total' };

function movementSize(row: LineMovement) {
  const unit = row.market === 'h2h' ? ' cents' : ['spreads', 'totals'].includes(row.market) ? ' pts' : '';
  return `${formatNumber.format(row.average)}${unit}`;
}

function askAbout(row: LineMovement, onAsk: (prompt: string) => void) {
  onAsk(`Analyze this BetTrack movement snapshot: ${row.matchup}, ${marketLabels[row.market] ?? row.market}, ${row.type}, average movement ${movementSize(row)} across ${row.books} books, detected at ${row.detectedAt}. Explain what the snapshot supports and what needs a fresh price check. Do not infer a specific side or direction from the aggregate.`);
}

export default function ResearchWorkspace({ onAsk, onNavigate }: {
  onAsk: (prompt: string) => void;
  onNavigate: (view: View) => void;
}) {
  const [section, setSection] = useState<'research' | 'tracking'>('research');
  const [hours, setHours] = useState('24');
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState<{ key: string; snapshot?: WorkspaceSnapshot }>();
  const key = `${hours}:${refresh}`;
  const current = result?.key === key ? result : undefined;
  const snapshot = current?.snapshot;

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}api/workspace?hours=${hours}`, {
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('Workspace request failed');
        const snapshot = await response.json() as WorkspaceSnapshot;
        if (!controller.signal.aborted) setResult({ key, snapshot });
      } catch {
        if (!controller.signal.aborted) setResult({ key });
      }
    }
    void load();
    return () => controller.abort();
  }, [hours, key]);

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-8">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
        <div>
          <h1 className="text-3xl font-semibold text-head">Research Workspace</h1>
          <p className="mt-2 text-sm text-frost">Review market moves, check model performance and follow your picks.</p>
        </div>
        {section === 'research' && <button type="button" className={button} onClick={() => setRefresh((count) => count + 1)}>Refresh</button>}
      </header>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Workspace section">
        <button type="button" className={button} aria-pressed={section === 'research'} onClick={() => setSection('research')}>Market research</button>
        <button type="button" className={button} aria-pressed={section === 'tracking'} onClick={() => setSection('tracking')}>Ledger &amp; comparison</button>
      </div>

      {section === 'tracking' ? <WorkspaceTracking /> : (
        <>
          {!current && <p role="status" className="text-sm text-frost">Loading workspace…</p>}
          {current && !snapshot && <p role="alert" className="text-sm text-head">Could not load the workspace. Refresh to try again.</p>}

          <section className={panel} aria-labelledby="line-movements">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 id="line-movements" className="text-lg font-semibold text-head">Line movements</h2>
                <p className="text-sm text-frost2">BetTrack</p>
              </div>
              <label className="flex items-center gap-2 text-sm text-frost">
                Window
                <select className={`${button} bg-panel`} value={hours} onChange={(event) => setHours(event.target.value)}>
                  <option value="24">24 hours</option>
                  <option value="72">72 hours</option>
                  <option value="168">7 days</option>
                </select>
              </label>
            </div>
            {snapshot && snapshot.markets.status !== 'ready' && (
              <p className="mt-4 text-sm text-frost2">{connectorMessage(snapshot.markets.status, 'BetTrack')}</p>
            )}
            {snapshot?.markets.status === 'ready' && (
              snapshot.markets.data.movements.length ? (
                <>
                  <p className="mt-4 text-xs text-frost2">Showing {snapshot.markets.data.movements.length} of {snapshot.markets.data.total} detected moves</p>
                  <ul className="mt-2 divide-y divide-line">
                    {snapshot.markets.data.movements.map((row) => (
                      <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                        <div>
                          <p className="font-semibold text-head">{row.matchup}</p>
                          <p className="mt-1 text-sm text-frost">
                            {marketLabels[row.market] ?? row.market} · {row.type} · {movementSize(row)} average move · {row.books} books
                          </p>
                          <time className="text-xs text-frost2" dateTime={row.detectedAt}>{formatTime.format(new Date(row.detectedAt))}</time>
                        </div>
                        <button type="button" className={button} onClick={() => askAbout(row, onAsk)} aria-label={`Ask analyst about ${row.matchup}`}>Ask analyst</button>
                      </li>
                    ))}
                  </ul>
                </>
              ) : <p className="mt-4 text-sm text-frost2">No movements in this window.</p>
            )}
          </section>

          {snapshot && (
            <div className="grid gap-4 sm:grid-cols-3">
              <ConnectorCard title="BetIQ · Closing-line value" value={snapshot.clv}>
                {({ sample, beatClose }) => (
                  <>
                    <p className="text-2xl font-semibold text-head">{beatClose == null ? '—' : `${formatNumber.format(beatClose)}%`}</p>
                    <p className="mt-1 text-sm text-frost2">{sample ? `Beat the closing price · ${sample} legs over 30 days` : 'No comparable legs over 30 days'}</p>
                  </>
                )}
              </ConnectorCard>
              <ConnectorCard title="BetIQ · Model" value={snapshot.model}>
                {({ version, auc }) => (
                  <>
                    <p className="text-2xl font-semibold text-head">{version ?? 'No version reported'}</p>
                    <p className="mt-1 text-sm text-frost2">Holdout AUC {auc == null ? 'unavailable' : auc.toFixed(3)}</p>
                  </>
                )}
              </ConnectorCard>
              <ConnectorCard title="BetIQ · Tracked bankroll" value={snapshot.bankroll}>
                {({ balance, growth, tracked }) => (
                  <>
                    <p className="text-2xl font-semibold text-head">{formatNumber.format(balance)}</p>
                    <p className="mt-1 text-sm text-frost2">{formatNumber.format(growth)}% growth · {tracked} tracked bets</p>
                  </>
                )}
              </ConnectorCard>
            </div>
          )}

          <nav aria-label="Research tools" className="flex flex-wrap gap-2">
            <button type="button" className={button} onClick={() => onNavigate('research')}>Prop Research</button>
            <button type="button" className={button} onClick={() => onNavigate('my-picks')}>My Picks</button>
            <button type="button" className={button} onClick={() => onNavigate('results')}>Results</button>
          </nav>
        </>
      )}
    </div>
  );
}
