import { useEffect, useMemo, useState } from 'react';
import {
  americanToImplied,
  evFromConfidence,
  formatAmerican,
  gradeForConfidence,
} from '../lib/odds';
import { fetchPerformance, type PerformanceSummary, type TopEdgePick } from '../lib/api';
import { EmptyHint, GradePill, ProbabilityBar, Skeleton, SportTag, Stat } from './ui/primitives';
import PriceLab from './PriceLab';
import { edgePickToLeg, marketFamily, quoteAge } from '../lib/research';
import { legKey } from '../lib/odds';
import type { SgpLeg } from '../types';

interface BestBetsProps {
  /** Pre-loaded performance data (e.g. from Today). When null, the page fetches it itself. */
  performance: PerformanceSummary | null;
  loading: boolean;
  error: string | null;
  onAddLeg: (pick: TopEdgePick) => void;
  slipLegs: SgpLeg[];
  onResearch: () => void;
}

type SportFilter = 'ALL' | 'MLB' | 'NFL' | 'NBA' | 'NHL';

const SPORT_FILTERS: SportFilter[] = ['ALL', 'MLB', 'NFL', 'NBA', 'NHL'];

function displayMarket(market: string): string {
  const labels: Record<string, string> = {
    hits: 'Hits', totalBases: 'Total Bases', homeRuns: 'Home Runs', rbi: 'RBIs', runs: 'Runs',
    strikeouts: 'Strikeouts', outsRecorded: 'Outs Recorded', passingYards: 'Passing Yards',
    passingTouchdowns: 'Passing Touchdowns', rushingYards: 'Rushing Yards', receivingYards: 'Receiving Yards',
    receptions: 'Receptions', rushingReceivingYards: 'Rushing + Receiving Yards', touchdowns: 'Touchdowns',
    points: 'Points', rebounds: 'Rebounds', assists: 'Assists', threePointersMade: '3-Pointers',
    shotsOnGoal: 'Shots on Goal', hockeyPoints: 'Hockey Points', saves: 'Saves', goals: 'Goals',
  };
  return labels[market] ?? market.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ');
}

export default function BestBets({ performance: externalPerformance, loading: externalLoading, error: externalError, onAddLeg, slipLegs, onResearch }: BestBetsProps) {
  // When no parent supplies performance data (standalone page), fetch it here.
  const [selfData, setSelfData] = useState<PerformanceSummary | null>(null);
  const [selfLoading, setSelfLoading] = useState(externalPerformance == null);
  const [selfError, setSelfError] = useState<string | null>(null);

  useEffect(() => {
    if (externalPerformance != null) return;
    let cancelled = false;
    fetchPerformance()
      .then((payload) => { if (!cancelled) { setSelfData(payload.performance); setSelfError(null); } })
      .catch((e: unknown) => { if (!cancelled) setSelfError(e instanceof Error ? e.message : 'Could not load best bets.'); })
      .finally(() => { if (!cancelled) setSelfLoading(false); });
    return () => { cancelled = true; };
  }, [externalPerformance]);

  const [sportFilter, setSportFilter] = useState<SportFilter>('ALL');
  const [marketFilter, setMarketFilter] = useState<string>('All');
  const [minEdge, setMinEdge] = useState<number>(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('edge');
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(timer); }, []);
  const addedKeys = new Set(slipLegs.map(legKey));

  const performance = externalPerformance ?? selfData;
  const loading = externalLoading || (externalPerformance == null && selfLoading);
  const error = externalError ?? selfError;
  const picks = performance?.insights.topEdges ?? [];

  const filtered = useMemo(() => {
    return picks.filter((pick) => {
      if (sportFilter !== 'ALL' && pick.sport.toUpperCase() !== sportFilter) return false;
      if (marketFilter !== 'All' && marketFamily(pick.market) !== marketFilter) return false;
      if (!`${pick.selection} ${pick.matchup} ${pick.market}`.toLowerCase().includes(search.trim().toLowerCase())) return false;
      if (pick.odds == null || !Number.isFinite(pick.odds) || Math.abs(pick.odds) < 100 || pick.edgePct == null || !Number.isFinite(pick.edgePct) || pick.edgePct <= 0 || pick.edgePct < minEdge) return false;
      return true;
    }).sort((a, b) => sort === 'recent' ? Date.parse(b.recommendedAt) - Date.parse(a.recommendedAt) : sort === 'sample' ? (b.modelSampleSize ?? 0) - (a.modelSampleSize ?? 0) : (b.edgePct ?? 0) - (a.edgePct ?? 0));
  }, [picks, sportFilter, marketFilter, minEdge, search, sort]);

  const availableMarkets = useMemo(() => {
    const set = new Set<string>();
    for (const pick of picks) {
      if (sportFilter === 'ALL' || pick.sport.toUpperCase() === sportFilter) {
        set.add(marketFamily(pick.market));
      }
    }
    return ['All', ...Array.from(set).sort()];
  }, [picks, sportFilter]);

  return (
    <div className="mx-auto w-full max-w-5xl px-3 py-4 pb-24 sm:px-5 md:pb-8">
      <header className="desk-heading mb-5">
        <p className="font-mono text-[10px] uppercase tracking-[.18em] text-edge">SportsEdge / Decision workspace</p>
        <h2 className="mt-2 text-3xl font-bold tracking-tight text-head">The Edge Desk</h2>
        <p className="mt-0.5 text-[11px] text-muted">
          Find an angle. Inspect the evidence. Stress-test the price. These are stored recommendations, not a live sportsbook feed.
        </p>
        <button type="button" onClick={onResearch} className="mt-3 min-h-10 rounded-lg border border-edge/40 px-3 text-xs font-semibold text-edge">Open Prop Research →</button>
      </header>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <label className="w-full text-xs text-frost2">Search player, matchup or market<input type="search" value={search} onChange={(e) => setSearch(e.target.value)} className="mt-2 min-h-11 w-full rounded-lg border border-line bg-panel px-3 text-sm text-head" placeholder="Find your angle…" /></label>
        <div className="flex max-w-full overflow-x-auto rounded-lg border border-line" role="group" aria-label="Sport filter">
          {SPORT_FILTERS.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={sportFilter === s}
              onClick={() => { setSportFilter(s); setMarketFilter('All'); }}
              className={`min-h-9 px-3 text-[11px] font-bold transition-colors ${
                sportFilter === s ? 'bg-edge/15 text-edge' : 'bg-panel text-frost2 hover:bg-panel2 hover:text-frost'
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        <select
          value={marketFilter}
          onChange={(e) => setMarketFilter(e.target.value)}
          aria-label="Market filter"
          className="min-h-9 rounded-lg border border-line bg-panel px-2.5 text-[11px] font-medium text-frost focus:border-edge/50 focus:outline-none"
        >
          {availableMarkets.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>

        <label className="flex min-h-9 items-center gap-2 rounded-lg border border-line bg-panel px-2.5 text-[11px] text-frost2">
          Min edge
          <select
            value={minEdge}
            onChange={(e) => setMinEdge(Number(e.target.value))}
            aria-label="Minimum edge"
            className="bg-transparent font-bold text-frost focus:outline-none"
          >
            <option value={0}>any</option>
            <option value={1}>1%+</option>
            <option value={3}>3%+</option>
            <option value={5}>5%+</option>
          </select>
        </label>
        <select aria-label="Sort recommendations" value={sort} onChange={(e) => setSort(e.target.value)} className="min-h-10 rounded-lg border border-line bg-panel px-3 text-xs text-head"><option value="edge">Highest edge</option><option value="recent">Most recent</option><option value="sample">Largest sample</option></select>
      </div>
      <p className="mb-4 border-l-2 border-warn pl-3 text-xs leading-relaxed text-frost2">Prices and availability were checked when recommended. Recommendations older than 15 minutes are flagged for review; their quote capture time is unavailable. Verify at your book before use.</p>

      {loading && (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-28 w-full" />)}
        </div>
      )}

      {error && !loading && (
        <div className="rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger" role="alert">{error}</div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <EmptyHint>
          {picks.length ? 'No recommendations match these filters.' : 'No priced recommendations with positive model edge are stored for today.'}
          {picks.length > 0 && <button type="button" onClick={() => { setSearch(''); setSportFilter('ALL'); setMarketFilter('All'); setMinEdge(0); }} className="ml-2 min-h-11 text-edge underline">Clear filters</button>}
        </EmptyHint>
      )}

      {!loading && !error && filtered.length > 0 && (
        <>
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Qualifying" value={String(filtered.length)} />
            <Stat
              label="Median edge"
              value={
                filtered.some((p) => p.edgePct != null)
                  ? `${median(filtered.map((p) => p.edgePct).filter((v): v is number => v != null)).toFixed(1)}%`
                  : '—'
              }
            />
            <Stat label="Avg confidence" value={`${avg(filtered.map((p) => p.confidence)).toFixed(0)}%`} />
            <Stat label="Priced legs" value={String(filtered.filter((p) => p.odds != null).length)} />
          </div>

          <ul className="space-y-3">
            {filtered.map((pick) => (
              <BetCard
                key={pick.predictionId + pick.selection}
                pick={pick}
                expanded={expandedId === pick.predictionId + pick.selection}
                onToggle={() =>
                  setExpandedId((cur) => (cur === pick.predictionId + pick.selection ? null : pick.predictionId + pick.selection))
                }
                onAdd={() => onAddLeg(pick)}
                added={addedKeys.has(legKey(edgePickToLeg(pick)))}
                now={now}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export function addKeyFor(pick: TopEdgePick): string {
  return `${pick.predictionId}:${pick.selection}`;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function avg(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function BetCard({ pick, expanded, onToggle, onAdd, added, now }: {
  pick: TopEdgePick;
  expanded: boolean;
  onToggle: () => void;
  onAdd: () => void;
  added: boolean;
  now: number;
}) {
  const grade = gradeForConfidence(pick.confidence);
  const implied = typeof pick.impliedProbability === 'number'
    ? pick.impliedProbability * (pick.impliedProbability <= 1 ? 100 : 1)
    : pick.odds != null
      ? americanToImplied(pick.odds) * 100
      : null;
  const ev = pick.odds != null ? evFromConfidence(pick.confidence, pick.odds) : NaN;

  return (
    <li className="overflow-hidden border-b border-line bg-panel/40">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-start justify-between gap-3 px-4 py-3 text-left hover:bg-panel2/40"
      >
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-2">
            <SportTag sport={pick.sport} />
            <span className="truncate font-mono text-[10px] text-frost2">{displayMarket(pick.market)}</span>
          </div>
          <p className="truncate text-[13px] font-semibold text-head">{pick.selection}</p>
          <p className="mt-0.5 truncate text-[11px] text-muted">{pick.matchup}</p>
          <p className={`mt-2 text-[11px] ${quoteAge(pick.recommendedAt, now).review ? 'text-warn' : 'text-frost2'}`}>{quoteAge(pick.recommendedAt, now).label} · {quoteAge(pick.recommendedAt, now).review ? 'Recheck price' : 'Stored quote'}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <GradePill grade={grade.grade} confidence={Math.round(pick.confidence)} />
          <span className={`font-mono text-[12px] font-bold ${pick.odds != null ? 'text-edge' : 'text-frost2'}`}>
            {pick.odds != null ? formatAmerican(pick.odds) : 'Unpriced'}
          </span>
          <span className={`font-mono text-[10px] ${(pick.edgePct ?? -1) > 0 ? 'text-edge' : 'text-warn'}`}>
            {pick.edgePct != null ? `+${pick.edgePct.toFixed(1)}% edge` : 'no price'}
          </span>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-line/60 px-4 py-3">
          <ProbabilityBar modelPct={pick.confidence} impliedPct={implied} />

          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[11px] sm:grid-cols-3">
            <Detail label="Model probability" value={`${pick.confidence.toFixed(1)}%`} />
            <Detail label="Implied probability" value={implied != null ? `${implied.toFixed(1)}%` : '—'} />
            <Detail label="Model edge" value={pick.edgePct != null ? `+${pick.edgePct.toFixed(2)}%` : 'unpriced'} />
            <Detail label="EV (per unit)" value={Number.isFinite(ev) ? `${(ev * 100).toFixed(1)}%` : '—'} />
            <Detail label="Model / version" value={pick.model} />
            <Detail label="Recommended" value={new Date(pick.recommendedAt).toLocaleString()} />
            {pick.eventDate && <Detail label="Event date" value={pick.eventDate} />}
            <Detail label="Model evidence source" value={pick.source ?? 'unavailable'} />
            <Detail label="Quote capture time" value="Unavailable; recommendation time shown" />
            {pick.modelSampleSize != null && <Detail label="Model sample size" value={`n=${pick.modelSampleSize}`} />}
            <Detail
              label="Availability"
              value={pick.lineupStatus ?? 'Screened at recommendation; recheck before use'}
              warn={Boolean(pick.lineupStatus)}
            />
          </dl>
          <PriceLab confidence={pick.confidence} odds={pick.odds} />

          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={onAdd}
              disabled={added}
              className="min-h-10 flex-1 rounded-lg bg-edge px-3 py-2 text-[12px] font-bold text-ink hover:brightness-105 disabled:bg-line disabled:text-frost2"
            >
              {added ? 'On your slip' : 'Add to Slip'}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

function Detail({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <div>
      <dt className="font-mono text-[9px] uppercase tracking-wider text-frost2">{label}</dt>
      <dd className={`mt-0.5 truncate font-medium ${warn ? 'text-warn' : 'text-head'}`} title={value}>{value}</dd>
    </div>
  );
}
