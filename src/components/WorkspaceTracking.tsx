import { useEffect, useState } from 'react';
import type {
  ComparisonResults, LedgerSource, TrackedEntry, TrackingSnapshot,
} from '../../server/src/workspace';
import { formatAmerican } from '../lib/odds';

const sources: LedgerSource[] = ['SportsEdge', 'BetTrack', 'BetIQ'];
const numberFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const selectClass = 'min-h-10 rounded-lg border border-line bg-panel px-3 text-sm text-head';
const panel = 'rounded-xl border border-line bg-panel p-4 sm:p-5';

function metric(value: number | null, suffix = '') {
  return value === null ? '—' : `${numberFormat.format(value)}${suffix}`;
}

function comparisonRows(user: ComparisonResults, model: ComparisonResults) {
  return [
    ['Settled tickets', user.settled, model.settled],
    ['Record', `${user.wins}–${user.losses}`, `${model.wins}–${model.losses}`],
    ['Reported net P&L', metric(user.profit), metric(model.profit)],
    ['ROI', metric(user.roi, '%'), metric(model.roi, '%')],
    ['Win rate', metric(user.hitRate, '%'), metric(model.hitRate, '%')],
  ];
}

function Comparison({ value, days, onDays }: {
  value: TrackingSnapshot['comparison'] | undefined;
  days: string;
  onDays: (days: string) => void;
}) {
  return (
    <section className={panel} aria-labelledby="workspace-comparison">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-head" id="workspace-comparison">You vs. the model</h2>
          <p className="mt-1 text-sm text-frost2">BetIQ pregame picks compared with model paper bets. Cash-outs are excluded.</p>
        </div>
        <div className="flex items-center gap-2 text-sm text-frost">
          <label htmlFor="comparison-period">Period</label>
          <select id="comparison-period" className={selectClass} value={days} onChange={(event) => onDays(event.target.value)}>
            <option value="7">7 days</option>
            <option value="30">30 days</option>
            <option value="90">90 days</option>
          </select>
        </div>
      </div>
      {value?.status === 'ready' && (
        <>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-sm text-head">
              <caption className="mb-2 text-left text-xs text-frost2">BetIQ game dates since {value.data.since}</caption>
              <thead className="border-b border-line text-frost">
                <tr>
                  <th className="py-2 pr-3" scope="col">Metric</th>
                  <th className="px-2 py-2 text-right" scope="col">Your BetIQ picks</th>
                  <th className="py-2 pl-2 text-right" scope="col">Model</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {comparisonRows(value.data.user, value.data.model).map(([label, user, model]) => (
                  <tr key={label}>
                    <th scope="row" className="py-2 pr-3 font-medium text-frost">{label}</th>
                    <td className="px-2 py-2 text-right tabular-nums">{user}</td>
                    <td className="py-2 pl-2 text-right tabular-nums">{model}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {(!value.data.user.settled || !value.data.model.settled) && (
            <p className="mt-2 text-sm text-frost2">Both groups need settled tickets for a head-to-head comparison.</p>
          )}
        </>
      )}
      {value?.status === 'unconfigured' && <p className="mt-3 text-sm text-frost2">Connect BetIQ to load this comparison.</p>}
      {value?.status === 'unavailable' && <p className="mt-3 text-sm text-frost2">The BetIQ comparison is unavailable.</p>}
    </section>
  );
}

function HistoryItem({ source, entry, overlaps }: {
  source: LedgerSource;
  entry: TrackedEntry;
  overlaps: TrackingSnapshot['overlaps'];
}) {
  const price = entry.price?.format === 'american' ? formatAmerican(entry.price.value)
    : entry.price ? `${metric(entry.price.value)} decimal` : null;
  return (
    <li className="py-3">
      <details>
        <summary className="cursor-pointer text-sm font-semibold text-head">
          {entry.title}
          <span className="ml-2 font-normal text-frost2">{source} · {entry.kind} · {entry.status}{price ? ` · ${price}` : ''}</span>
        </summary>
        {entry.recordedAt && (
          <p className="mt-1 pl-4 text-xs text-frost2">
            <span className="capitalize">{entry.recordType}</span>{' '}
            <time dateTime={entry.recordedAt}>{dateFormat.format(new Date(entry.recordedAt))}</time>
          </p>
        )}
        <p className="mt-1 break-all pl-4 text-xs text-frost2">Record ID {entry.id}</p>
        {entry.selections.length === 0 ? (
          <p className="mt-2 pl-4 text-sm text-frost2">Selection details are unavailable from this source.</p>
        ) : (
          <ul className="mt-2 space-y-2 border-l border-line pl-4">
            {entry.selections.map((selection) => {
              const ids = overlaps.find((entry) => entry.selectionId === selection.id)?.sportsEdgeIds;
              return (
                <li key={selection.id} className="text-sm text-frost">
                  <div>{selection.name}{selection.americanOdds === null ? '' : ` · ${formatAmerican(selection.americanOdds)}`}</div>
                  <div className="text-xs text-frost2">
                    {[selection.event, selection.eventDate, selection.market, selection.line, selection.status].filter((value) => value != null).join(' · ')}
                  </div>
                  {ids && <div className="break-all text-xs text-warn">Possible selection overlap with SportsEdge {ids.join(', ')}</div>}
                </li>
              );
            })}
          </ul>
        )}
      </details>
    </li>
  );
}

export default function WorkspaceTracking() {
  const [days, setDays] = useState('30');
  const [refresh, setRefresh] = useState(0);
  const [source, setSource] = useState<LedgerSource | 'all'>('all');
  const [result, setResult] = useState<{ key: string; data?: TrackingSnapshot }>();
  const key = `${days}:${refresh}`;
  const current = result?.key === key ? result : undefined;
  const data = current?.data;

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}api/workspace/tracking?days=${days}`, {
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('Tracking request failed');
        const data = await response.json() as TrackingSnapshot;
        if (!controller.signal.aborted) setResult({ key, data });
      } catch {
        if (!controller.signal.aborted) setResult({ key });
      }
    }
    void load();
    return () => controller.abort();
  }, [days, key]);

  const visibleSources = source === 'all' ? sources : [source];
  const entries = visibleSources.flatMap((source) => {
    const history = data?.sources[source];
    return history?.status === 'ready' ? history.data.entries.map((entry) => ({ source, entry })) : [];
  }).sort((a, b) => (b.entry.recordedAt ?? '').localeCompare(a.entry.recordedAt ?? ''));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {!current && <p role="status" className="text-sm text-frost">Loading tracking data…</p>}
        {current && !data && <p role="alert" className="text-sm text-head">Could not load tracking data. Refresh to try again.</p>}
        <button className={`${selectClass} ml-auto hover:bg-panel2`} type="button" onClick={() => setRefresh((count) => count + 1)}>Refresh tracking</button>
      </div>
      <Comparison value={data?.comparison} days={days} onDays={setDays} />
      {data && (
        <section className={panel} aria-labelledby="workspace-ledger">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 id="workspace-ledger" className="text-lg font-semibold text-head">Unified ledger</h2>
              <p className="mt-1 text-sm text-frost2">Recent records from each source. Each source keeps its own results and totals.</p>
            </div>
            <div className="flex items-center gap-2 text-sm text-frost">
              <label htmlFor="ledger-source">Source</label>
              <select id="ledger-source" value={source} onChange={(event) => setSource(event.target.value as LedgerSource | 'all')} className={selectClass}>
                <option value="all">All sources</option>
                {sources.map((name) => <option key={name}>{name}</option>)}
              </select>
            </div>
          </div>
          <ul className="mt-3 space-y-1 text-xs text-frost2">
            {visibleSources.map((source) => {
              const result = data.sources[source];
              const message = result.status === 'ready' ? `${result.data.entries.length} of ${result.data.total} records`
                : result.status === 'unconfigured' ? 'Connector setup needed' : 'History unavailable';
              return <li key={source}><span className="font-semibold text-frost">{source}</span> · {message}</li>;
            })}
          </ul>
          {(source === 'all' || source === 'BetTrack') && data.overlaps.length > 0 && (
            <p className="mt-3 text-sm text-warn">{data.overlaps.length} BetTrack selections may overlap with saved SportsEdge legs. Open a ticket to review its matches.</p>
          )}
          {entries.length > 0 ? (
            <ul className="mt-3 divide-y divide-line border-t border-line">
              {entries.map(({ source, entry }) => (
                <HistoryItem key={`${source}:${entry.id}`} source={source} entry={entry}
                  overlaps={source === 'BetTrack' ? data.overlaps.filter((item) => item.ticketId === entry.id) : []} />
              ))}
            </ul>
          ) : <p className="mt-3 text-sm text-frost2">No records to display.</p>}
        </section>
      )}
    </div>
  );
}
