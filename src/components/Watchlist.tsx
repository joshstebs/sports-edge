import { useMemo, useState } from 'react';
import { displayPropMarket, fetchPlayerResearch } from '../lib/api';
import { researchSummary } from '../lib/research';
import {
  compareSnapshots,
  loadWatchlist,
  removeWatch,
  saveWatchlist,
  type WatchItem,
  type WatchSnapshot,
} from '../lib/watchlist';

export default function Watchlist({ userId, onOpenResearch }: { userId: string; onOpenResearch: (player: string) => void }) {
  const [items, setItems] = useState<WatchItem[]>(() => loadWatchlist(userId));
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  function persist(next: WatchItem[]) {
    setItems(next);
    try { saveWatchlist(userId, next); } catch { setError('This browser could not store the watchlist.'); }
  }

  const groups = useMemo(() => {
    const order: WatchItem['kind'][] = ['research', 'prop', 'player', 'matchup'];
    return order.map((kind) => ({ kind, items: items.filter((item) => item.kind === kind) })).filter((group) => group.items.length);
  }, [items]);

  async function refresh(item: WatchItem) {
    if (!item.player || !item.market) {
      setNotes((prev) => ({ ...prev, [item.id]: 'Nothing comparable to refresh. This bookmark has no published game-log query.' }));
      return;
    }
    setBusy(item.id);
    setError('');
    try {
      const result = await fetchPlayerResearch(item.sport, item.player, item.market, item.windowSize ?? 10);
      if (!result.available) {
        setNotes((prev) => ({ ...prev, [item.id]: result.reason || 'Published logs are unavailable. The previous snapshot was kept.' }));
        return;
      }
      const line = item.line ?? null;
      const side = item.side ?? 'over';
      const summary = researchSummary(result.observations ?? [], line ?? NaN, side, item.windowSize ?? 10);
      const nextSnapshot: WatchSnapshot = {
        checkedAt: new Date().toISOString(),
        average: summary.average,
        sample: summary.games.length,
        hitRate: line != null ? summary.rate : null,
        line,
        side: line != null ? side : null,
      };
      const note = compareSnapshots(item.snapshot, nextSnapshot) ?? 'First comparable snapshot saved. No earlier observation to diff.';
      setNotes((prev) => ({ ...prev, [item.id]: note }));
      persist(items.map((existing) => existing.id === item.id ? { ...existing, snapshot: nextSnapshot } : existing));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not refresh this bookmark.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="workspace-pad mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <header className="desk-heading">
        <p className="kicker">SportsEdge / Watchlist</p>
        <h2 className="display mt-3 text-4xl text-head sm:text-5xl">Saved angles, not alerts.</h2>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-frost2">
          Bookmarks stay on this account in this browser. Refresh compares a new official log only when the line and side still match. SportsEdge is not watching the market in the background.
        </p>
      </header>
      {error && <p role="alert" className="mt-4 border border-danger/40 px-3 py-2 text-sm text-danger">{error}</p>}
      {items.length === 0 ? (
        <p className="mt-8 max-w-lg text-sm leading-relaxed text-frost2">Nothing saved yet. From Prop Research, bookmark a player, a line, or the current research view.</p>
      ) : (
        <div className="mt-6 space-y-8">
          {groups.map((group) => (
            <section key={group.kind}>
              <h3 className="kicker">{group.kind}</h3>
              <ul className="mt-3 divide-y divide-line border-y border-line">
                {group.items.map((item) => (
                  <li key={item.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-base font-semibold text-head">{item.label}</p>
                      <p className="mt-1 text-xs text-frost2">
                        {item.sport}
                        {item.market ? ` · ${displayPropMarket(item.market)}` : ''}
                        {item.side && item.line != null ? ` · ${item.side} ${item.line}` : ''}
                        {item.matchup ? ` · ${item.matchup}` : ''}
                      </p>
                      {item.snapshot && (
                        <p className="num mt-2 text-xs text-frost">
                          Last check {item.snapshot.checkedAt.slice(0, 16).replace('T', ' ')}
                          {item.snapshot.average != null ? ` · avg ${item.snapshot.average.toFixed(1)}` : ''}
                          {item.snapshot.sample ? ` · n=${item.snapshot.sample}` : ''}
                          {item.snapshot.hitRate != null ? ` · hit ${item.snapshot.hitRate.toFixed(0)}%` : ''}
                        </p>
                      )}
                      {notes[item.id] && <p className="mt-2 text-sm text-edge">{notes[item.id]}</p>}
                    </div>
                    <div className="flex shrink-0 gap-2">
                      {item.player && (
                        <button type="button" onClick={() => onOpenResearch(item.player!)} className="min-h-11 border border-line px-3 text-xs font-semibold text-head">Open</button>
                      )}
                      <button type="button" onClick={() => void refresh(item)} disabled={busy === item.id} className="min-h-11 bg-edge px-3 text-xs font-bold text-ink disabled:opacity-50">
                        {busy === item.id ? 'Checking…' : 'Refresh'}
                      </button>
                      <button type="button" onClick={() => persist(removeWatch(items, item.id))} className="min-h-11 px-3 text-xs font-semibold text-frost2">Remove</button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
