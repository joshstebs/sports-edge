import { useEffect, useMemo, useState } from 'react';
import { fetchLedger, type LedgerPick } from '../lib/api';
import { formatAmerican } from '../lib/odds';
import { EmptyHint, Skeleton, SportTag, Stat } from './ui/primitives';

type RangeFilter = 'today' | '7d' | '30d' | 'all';
type StatusFilter = 'all' | 'pending' | 'won' | 'lost' | 'push';
type SportFilter = 'ALL' | 'MLB' | 'NFL' | 'NBA' | 'NHL';

const RANGES: Array<{ id: RangeFilter; label: string }> = [
  { id: 'today', label: 'Today' },
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: 'all', label: 'All' },
];

const STATUSES: Array<{ id: StatusFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'pending', label: 'Pending' },
  { id: 'won', label: 'Won' },
  { id: 'lost', label: 'Lost' },
  { id: 'push', label: 'Push' },
];

const SPORTS: SportFilter[] = ['ALL', 'MLB', 'NFL', 'NBA', 'NHL'];

function inRange(pick: LedgerPick, range: RangeFilter): boolean {
  if (range === 'all') return true;
  const created = new Date(pick.createdAt).getTime();
  if (!Number.isFinite(created)) return false;
  if (range === 'today') {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    return created >= start.getTime();
  }
  const days = range === '7d' ? 7 : 30;
  return created >= Date.now() - days * 86400_000;
}

/** Units result at the stored American odds. Push = 0, no odds = uncounted. */
function unitsFor(pick: LedgerPick): number | null {
  if (pick.status === 'push') return 0;
  if (typeof pick.odds !== 'number' || !Number.isFinite(pick.odds)) return null;
  if (pick.status === 'won') return pick.odds > 0 ? pick.odds / 100 : 100 / -pick.odds;
  if (pick.status === 'lost') return -1;
  return null;
}

export default function MyPicks() {
  const [picks, setPicks] = useState<LedgerPick[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<RangeFilter>('7d');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [sport, setSport] = useState<SportFilter>('ALL');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchLedger()
      .then(({ picks }) => { if (!cancelled) { setPicks(picks); setError(null); } })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load your tracked bets.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    const list = (picks ?? []).filter((pick) =>
      inRange(pick, range)
      && (status === 'all' || pick.status === status)
      && (sport === 'ALL' || String(pick.sport ?? '').toUpperCase() === sport),
    );
    return [...list].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [picks, range, status, sport]);

  const stats = useMemo(() => {
    const graded = filtered.filter((p) => p.status !== 'pending');
    const wins = graded.filter((p) => p.status === 'won').length;
    const losses = graded.filter((p) => p.status === 'lost').length;
    const pushes = graded.filter((p) => p.status === 'push').length;
    const unitsList = graded.map(unitsFor).filter((u): u is number => u != null);
    const units = unitsList.reduce((sum, u) => sum + u, 0);
    const decided = unitsList.filter((u) => u !== 0).length;
    return {
      record: decided > 0 ? `${wins}–${losses}${pushes ? `–${pushes}` : ''}` : '—',
      winRate: wins + losses > 0 ? (wins / (wins + losses)) * 100 : null,
      units,
      pending: filtered.filter((p) => p.status === 'pending').length,
      graded: graded.length,
    };
  }, [filtered]);

  return (
    <div className="mx-auto w-full max-w-5xl px-3 py-4 pb-24 sm:px-5 md:pb-8">
      <header className="mb-4">
        <h2 className="text-lg font-bold tracking-tight text-head">My Picks</h2>
        <p className="mt-0.5 text-[11px] text-muted">Every bet you saved &amp; tracked, settled independently against real outcomes.</p>
      </header>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex overflow-hidden rounded-lg border border-line" role="group" aria-label="Date range">
          {RANGES.map((r) => (
            <button
              key={r.id} type="button" onClick={() => setRange(r.id)} aria-pressed={range === r.id}
              className={`min-h-9 px-3 text-[11px] font-bold transition-colors ${range === r.id ? 'bg-edge/15 text-edge' : 'bg-panel text-frost2 hover:bg-panel2 hover:text-frost'}`}
            >
              {r.label}
            </button>
          ))}
        </div>

        <select
          value={sport} onChange={(e) => setSport(e.target.value as SportFilter)}
          aria-label="Sport filter"
          className="min-h-9 rounded-lg border border-line bg-panel px-2.5 text-[11px] font-medium text-frost focus:border-edge/50 focus:outline-none"
        >
          {SPORTS.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>

        <select
          value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}
          aria-label="Status filter"
          className="min-h-9 rounded-lg border border-line bg-panel px-2.5 text-[11px] font-medium text-frost focus:border-edge/50 focus:outline-none"
        >
          {STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </div>

      {loading && (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
      )}

      {error && !loading && (
        <div className="rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger" role="alert">{error}</div>
      )}

      {!loading && !error && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <Stat label="Record" value={stats.record} sub={`${stats.graded} graded · ${stats.pending} pending`} />
            <Stat label="Win rate" value={stats.winRate != null ? `${stats.winRate.toFixed(1)}%` : '—'} />
            <Stat
              label="Units"
              value={stats.units !== 0 || stats.graded > 0 ? `${stats.units > 0 ? '+' : ''}${stats.units.toFixed(2)}` : '—'}
              tone={stats.units > 0 ? 'positive' : stats.units < 0 ? 'negative' : 'default'}
            />
            <Stat label="Picks shown" value={String(filtered.length)} />
          </div>

          {filtered.length === 0 ? (
            <EmptyHint>
              No tracked picks in this view yet. Save a slip with “Save &amp; track” and every leg lands here for independent settlement.
            </EmptyHint>
          ) : (
            <ul className="space-y-2">
              {filtered.map((pick) => {
                const units = unitsFor(pick);
                const statusTone =
                  pick.status === 'won' ? 'bg-edge/15 text-edge'
                  : pick.status === 'lost' ? 'bg-danger/15 text-danger'
                  : pick.status === 'push' ? 'bg-panel2 text-frost2'
                  : 'bg-warn/10 text-warn';
                return (
                  <li key={pick.id} className="rounded-xl border border-line/60 bg-card/60 px-3.5 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="mb-1 flex flex-wrap items-center gap-1.5">
                          {pick.sport && <SportTag sport={pick.sport} />}
                          <span className="font-mono text-[9px] uppercase tracking-wide text-frost2">{pick.market ?? 'market n/a'}{pick.line != null ? ` ${pick.line}` : ''}</span>
                        </div>
                        <p className="truncate text-[12.5px] font-semibold text-head">{pick.selection}</p>
                        <p className="mt-0.5 truncate text-[10.5px] text-muted">{pick.game ?? 'matchup n/a'}</p>
                        <p className="mt-1 font-mono text-[9.5px] text-frost2/80">
                          saved {new Date(pick.createdAt).toLocaleString()}
                          {pick.settledAt ? ` · settled ${new Date(pick.settledAt).toLocaleDateString()}${pick.settlementSource ? ` (${pick.settlementSource})` : ''}` : ''}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1.5">
                        <span className={`rounded-full px-2.5 py-1 font-mono text-[10px] font-bold uppercase ${statusTone}`}>{pick.status}</span>
                        {pick.odds != null && (
                          <span className="rounded border border-edge/20 bg-edge/5 px-1.5 py-0.5 font-mono text-[10px] font-medium tabular-nums text-edge">
                            {formatAmerican(pick.odds)}
                          </span>
                        )}
                        {units != null && (
                          <span className={`font-mono text-[10px] ${units > 0 ? 'text-edge' : units < 0 ? 'text-danger' : 'text-frost2'}`}>
                            {units > 0 ? '+' : ''}{units.toFixed(2)}u
                          </span>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
