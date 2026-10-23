import { useEffect, useRef, useState, type FormEvent } from 'react';
import { displayPropMarket, fetchPlayerResearch, type PlayerResearchResponse } from '../lib/api';
import { researchSummary } from '../lib/research';
import { loadWatchlist, saveWatchlist, upsertWatch, type WatchItem } from '../lib/watchlist';
import PlayerHeadshot from './PlayerHeadshot';
import PropTrendChart from './PropTrendChart';

const MARKETS: Record<string, string[]> = {
  NFL: ['passingYards', 'passingTouchdowns', 'rushingYards', 'receivingYards', 'receptions'],
  NBA: ['points', 'rebounds', 'assists', 'threePointersMade'],
  NHL: ['shotsOnGoal', 'goals', 'assists', 'saves'],
  MLB: ['hits', 'totalBases', 'homeRuns', 'rbi', 'runs', 'strikeouts', 'outsRecorded'],
};

export default function ResearchDesk({
  onAsk,
  userId,
  seed = '',
}: {
  onAsk: (text: string) => void;
  userId: string;
  seed?: string;
}) {
  const [sport, setSport] = useState('NFL');
  const [name, setName] = useState(seed);
  const [market, setMarket] = useState('passingYards');
  const [line, setLine] = useState('');
  const [side, setSide] = useState<'over' | 'under'>('over');
  const [windowSize, setWindowSize] = useState(10);
  const [data, setData] = useState<PlayerResearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const request = useRef(0);

  useEffect(() => () => { request.current++; }, []);
  useEffect(() => {
    if (seed.trim()) setName(seed);
  }, [seed]);

  function reset() { request.current++; setLoading(false); setData(null); setError(''); setSaved(''); }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    const id = ++request.current;
    setLoading(true); setError(''); setData(null); setSaved('');
    try {
      const result = await fetchPlayerResearch(sport, name.trim(), market, 20);
      if (id === request.current) {
        if (result.available) setData(result);
        else setError(result.reason || 'No published game logs for this player and market.');
      }
    } catch (e) { if (id === request.current) setError(e instanceof Error ? e.message : 'Research unavailable.'); }
    finally { if (id === request.current) setLoading(false); }
  }

  const hasLine = line.trim() !== '' && Number.isFinite(Number(line)) && Number(line) >= 0;
  const numericLine = hasLine ? Number(line) : null;
  const summary = data ? researchSummary(data.observations ?? [], numericLine ?? NaN, side, windowSize) : null;
  const control = 'min-h-11 w-full border border-line bg-panel px-3 text-sm text-head';

  function bookmark(kind: WatchItem['kind']) {
    if (!data?.player) return;
    const item: WatchItem = {
      id: crypto.randomUUID(),
      kind,
      createdAt: new Date().toISOString(),
      sport,
      player: data.player,
      market,
      label: kind === 'player' ? data.player : `${data.player} · ${displayPropMarket(market)}${hasLine ? ` ${side} ${line}` : ''}`,
      line: kind === 'player' ? null : numericLine,
      side: kind === 'player' || !hasLine ? undefined : side,
      windowSize,
      snapshot: summary ? {
        checkedAt: new Date().toISOString(),
        average: summary.average,
        sample: summary.games.length,
        hitRate: hasLine ? summary.rate : null,
        line: numericLine,
        side: hasLine ? side : null,
      } : undefined,
    };
    try {
      saveWatchlist(userId, upsertWatch(loadWatchlist(userId), item));
      setSaved(kind === 'player' ? 'Player saved to your watchlist.' : 'Research view saved to your watchlist.');
    } catch {
      setSaved('Could not store this bookmark in the browser.');
    }
  }

  return (
    <div className="workspace-pad mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <header className="desk-heading">
        <p className="kicker">SportsEdge / Research</p>
        <h2 className="display mt-3 text-4xl text-head sm:text-5xl">Know the player.<br />Question the line.</h2>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-frost2">Official game logs, one market at a time. The chart is history. It is not the model’s probability.</p>
      </header>
      <form onSubmit={(e) => void submit(e)} className="mt-6 grid gap-4 border-y border-line py-5 sm:grid-cols-3">
        <label className="space-y-2 text-xs text-frost">Sport
          <select className={control} value={sport} onChange={(e) => { reset(); setSport(e.target.value); setMarket(MARKETS[e.target.value][0]); }}>{Object.keys(MARKETS).map((s) => <option key={s}>{s}</option>)}</select>
        </label>
        <label className="space-y-2 text-xs text-frost">Player
          <input required maxLength={100} className={control} value={name} onChange={(e) => { reset(); setName(e.target.value); }} placeholder="Full player name" />
        </label>
        <label className="space-y-2 text-xs text-frost">Market
          <select className={control} value={market} onChange={(e) => { reset(); setMarket(e.target.value); }}>{MARKETS[sport].map((m) => <option value={m} key={m}>{displayPropMarket(m)}</option>)}</select>
        </label>
        <button className="min-h-11 bg-edge px-4 text-sm font-bold text-ink disabled:opacity-50 sm:col-span-3" disabled={loading || !name.trim()}>{loading ? 'Looking up official logs…' : 'Research player'}</button>
      </form>
      {error && <p role="alert" className="mt-4 border border-warn/40 p-4 text-sm text-warn">{error}</p>}
      {!data && !loading && !error && <p className="mt-8 max-w-lg text-sm leading-relaxed text-frost2">Choose a player to start. Missing stats stay unavailable. This workspace does not assume the player is active or that a sportsbook offers the market.</p>}
      {data && summary && (
        <section className="mt-6" aria-label="Research results">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex min-w-0 items-center gap-4">
              <PlayerHeadshot sport={data.sport} name={data.player} className="h-16 w-16 shrink-0" />
              <div>
                <p className="kicker text-edge">{data.sport} / {displayPropMarket(data.market ?? market)}</p>
                <h3 className="display mt-1 text-3xl text-head">{data.player}</h3>
                <p className="mt-1 text-xs text-frost2">{data.team}{data.season ? ` · ${data.season} season` : ''}</p>
              </div>
            </div>
            <label className="text-xs text-frost">Window
              <select aria-label="Game window" value={windowSize} onChange={(e) => setWindowSize(Number(e.target.value))} className="ml-2 border border-line bg-panel p-2">{[5, 10, 20].map((n) => <option key={n} value={n}>Last {n}</option>)}</select>
            </label>
          </div>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-2 text-xs text-frost">Side
              <select aria-label="Research side" value={side} onChange={(e) => setSide(e.target.value as 'over' | 'under')} className={control}><option value="over">Over</option><option value="under">Under</option></select>
            </label>
            <label className="flex flex-col gap-2 text-xs text-frost">Test a line
              <input aria-label="Research line" type="number" min="0" step="any" value={line} onChange={(e) => setLine(e.target.value)} className={`${control} max-w-36`} placeholder="e.g. 49.5" />
            </label>
          </div>
          <div aria-live="polite" className="my-5 grid gap-4 border-y border-line py-4 sm:grid-cols-3">
            <div><p className="text-xs text-frost2">Observed average</p><p className="num mt-1 text-2xl text-head">{summary.average?.toFixed(1) ?? '—'}</p></div>
            <div>
              <p className="text-xs text-frost2">Historical hit rate</p>
              <p className="num mt-1 text-2xl text-edge">{hasLine && summary.rate != null ? `${summary.rate.toFixed(0)}%` : '—'}</p>
              <p className="mt-1 text-[11px] text-frost2">Excludes pushes. This is not a model probability.</p>
            </div>
            <p className="self-end text-xs text-frost2">{summary.games.length} published games{hasLine ? ` · ${summary.hits} hit${summary.hits === 1 ? '' : 's'} · ${summary.pushes} push${summary.pushes === 1 ? '' : 'es'}` : ' · enter a line for hit rates'}</p>
          </div>
          <PropTrendChart games={summary.games} line={numericLine} side={side} marketLabel={displayPropMarket(market)} />
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <caption className="pb-3 text-left text-frost2">Recent published results, newest first</caption>
              <thead className="border-b border-line text-frost2"><tr><th className="py-2">Date</th><th>Opponent</th><th className="text-right">{displayPropMarket(market)}</th><th className="text-right">At your line</th></tr></thead>
              <tbody>
                {summary.games.map((g, i) => {
                  const result = !hasLine ? '—' : g.value === Number(line) ? 'Push' : (side === 'over' ? g.value > Number(line) : g.value < Number(line)) ? 'Hit' : 'Miss';
                  return (
                    <tr key={`${g.gameId ?? g.date}-${i}`} className="border-b border-line/60">
                      <td className="py-3 pr-3 num text-frost">{g.date?.slice(0, 10) ?? 'Unpublished'}</td>
                      <td className="pr-3 text-frost2">{g.opponent ?? '—'}</td>
                      <td className="num text-right text-head">{g.value}</td>
                      <td className={`text-right ${result === 'Hit' ? 'text-edge' : result === 'Miss' ? 'text-danger' : 'text-frost2'}`}>{result}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-xs leading-relaxed text-frost2">Source: {data.source}. Opponent is shown when the log includes it. Home, away and rest splits are not in this payload, so they are not displayed. Availability, matchup and current odds still need verification.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={() => bookmark('player')} className="min-h-11 border border-line px-4 text-sm font-semibold text-head">Save player</button>
            <button type="button" onClick={() => bookmark(hasLine ? 'prop' : 'research')} className="min-h-11 border border-line px-4 text-sm font-semibold text-head">{hasLine ? 'Save this line' : 'Save research view'}</button>
            <button type="button" onClick={() => onAsk(`Research ${data.player} ${sport} ${displayPropMarket(market)}${hasLine ? ` ${side} ${line}` : ''}. Verify current availability, matchup and the exact sportsbook price before recommending a pick.`)} className="min-h-11 border border-edge/50 px-4 text-sm font-semibold text-edge">Ask the analyst to verify this angle</button>
          </div>
          {saved && <p className="mt-3 text-sm text-edge" role="status">{saved}</p>}
        </section>
      )}
    </div>
  );
}
