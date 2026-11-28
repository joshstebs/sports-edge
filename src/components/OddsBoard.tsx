import { useEffect, useState } from 'react';
import type { GameOddsSnapshot, OddsBoard as Board, OddsBoardSelection, OddsBoardSport } from '../../server/src/workspace';
import QuoteComparison from './QuoteComparison';

const sports: OddsBoardSport[] = ['nba', 'nfl', 'nhl', 'mlb'];
const control = 'min-h-10 min-w-0 rounded-lg border border-line bg-panel px-3 text-sm text-head';
const marketLabels = { h2h: 'Moneyline', spreads: 'Spread', totals: 'Total' };

function selectionId(row: OddsBoardSelection): string {
  return JSON.stringify([row.market, row.name, row.line]);
}

async function load<T>(path: string, params: Record<string, string>, signal: AbortSignal): Promise<T> {
  const response = await fetch(`${import.meta.env.BASE_URL}api/odds-board${path}?${new URLSearchParams(params)}`, {
    headers: { Accept: 'application/json' }, signal,
  });
  if (!response.ok) throw new Error('Sportsbook board could not load.');
  return response.json() as Promise<T>;
}

export default function OddsBoard() {
  const [manualOnly, setManualOnly] = useState(false);
  const [sport, setSport] = useState<OddsBoardSport>('nba');
  const [refresh, setRefresh] = useState(0);
  const [boardResult, setBoardResult] = useState<{ key: string; data?: Board }>();
  const [eventId, setEventId] = useState('');
  const [selectionKey, setSelectionKey] = useState('');
  const [snapshot, setSnapshot] = useState<{ key: string; data?: GameOddsSnapshot }>();
  const boardKey = `${sport}:${refresh}`;
  const boardResponse = boardResult?.key === boardKey ? boardResult : undefined;
  const board = boardResponse?.data;
  const event = board?.events.find(row => row.id === eventId) ?? board?.events[0];
  const espnEventId = board?.source === 'espn' ? event?.id : undefined;
  const snapshotKey = `${boardKey}:${espnEventId}`;
  const snapshotResponse = snapshot?.key === snapshotKey ? snapshot : undefined;
  const gameSnapshot = snapshotResponse?.data;
  const selections = gameSnapshot?.selections ?? event?.selections ?? [];
  const selected = selections.find(row => selectionId(row) === selectionKey) ?? selections[0];

  useEffect(() => {
    if (manualOnly) return;
    const controller = new AbortController();
    load<Board>('', { sport }, controller.signal).then(data => {
      if (!controller.signal.aborted) setBoardResult({ key: boardKey, data });
    }).catch(() => {
      if (!controller.signal.aborted) setBoardResult({ key: boardKey });
    });
    return () => controller.abort();
  }, [sport, boardKey, manualOnly]);

  useEffect(() => {
    if (manualOnly || !espnEventId) return;
    const controller = new AbortController();
    load<GameOddsSnapshot>('/game', { sport, event: espnEventId }, controller.signal).then(data => {
      if (!controller.signal.aborted) setSnapshot({ key: snapshotKey, data });
    }).catch(() => {
      if (!controller.signal.aborted) setSnapshot({ key: snapshotKey });
    });
    return () => controller.abort();
  }, [sport, espnEventId, snapshotKey, manualOnly]);

  if (manualOnly) {
    return (
      <div className="space-y-4">
        <button className={control} type="button" onClick={() => setManualOnly(false)}>Show odds board</button>
        <QuoteComparison />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-xs text-frost">League
          <select className={control} value={sport} onChange={event => {
            setSport(event.target.value as OddsBoardSport); setEventId(''); setSelectionKey('');
          }}>
            {sports.map(name => <option key={name} value={name}>{name.toUpperCase()}</option>)}
          </select>
        </label>
        {event && board && (
          <label className="grid min-w-0 flex-1 gap-1 text-xs text-frost">Game
            <select className={control} value={event.id} onChange={event => {
              setEventId(event.target.value); setSelectionKey('');
            }}>
              {board.events.map(row => <option key={row.id} value={row.id}>{row.away} at {row.home}</option>)}
            </select>
          </label>
        )}
        <button className={`${control} hover:border-edge`} type="button" onClick={() => setRefresh(value => value + 1)}>Refresh odds</button>
        <button className={`${control} hover:border-edge`} type="button" onClick={() => setManualOnly(true)}>Manual quotes only</button>
      </div>

      {!boardResponse && <p role="status" className="text-sm text-frost2">Loading upcoming games…</p>}
      {boardResponse && (!board || board.source === 'unavailable') && <p className="text-sm text-frost2">The live board is unavailable. You can still compare manual quotes.</p>}
      {board && board.source !== 'unavailable' && !event && <p className="text-sm text-frost2">No upcoming {sport.toUpperCase()} games listed.</p>}
      {espnEventId && !snapshotResponse && <p role="status" className="text-sm text-frost2">Loading game prices…</p>}
      {espnEventId && snapshotResponse && !selections.length && <p className="text-sm text-frost2">ESPN has no posted prices for this game.</p>}
      {espnEventId && (
        <a className="inline-block text-sm text-head underline" target="_blank" rel="noreferrer"
          href={`https://www.espn.com/${sport}/game/_/gameId/${encodeURIComponent(espnEventId)}`}>
          Check the source game on ESPN
        </a>
      )}

      {selected && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid min-w-0 gap-1 text-xs text-frost">Selection and line
            <select className={control} value={selectionId(selected)} onChange={event => setSelectionKey(event.target.value)}>
              {selections.map(row => <option key={selectionId(row)} value={selectionId(row)}>
                {marketLabels[row.market]} · {row.name}{row.line === null ? '' : ` ${row.market === 'spreads' && row.line > 0 ? '+' : ''}${row.line}`}
              </option>)}
            </select>
          </label>
          <p className="text-xs text-frost2">
            {board?.source === 'the-odds-api' ? 'The Odds API · US books'
              : gameSnapshot ? `ESPN · single-book snapshot checked ${new Date(gameSnapshot.observedAt).toLocaleString()}` : ''}
          </p>
        </div>
      )}
      <QuoteComparison key={`${sport}:${event?.id ?? ''}:${selected ? selectionId(selected) : ''}`} quotes={selected?.quotes} />
    </div>
  );
}
