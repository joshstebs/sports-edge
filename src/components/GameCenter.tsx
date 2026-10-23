import { useEffect, useMemo, useState } from 'react';
import {
  fetchInjuries,
  fetchPerformance,
  type InjuryEntry,
  type InjuryReportPayload,
  type TopEdgePick,
} from '../lib/api';
import { formatAmerican } from '../lib/odds';
import { quoteAge } from '../lib/research';

const SPORTS = ['NFL', 'NBA', 'NHL', 'MLB'] as const;

function groupByMatchup(picks: TopEdgePick[]): Array<{ matchup: string; eventDate: string | null; picks: TopEdgePick[] }> {
  const map = new Map<string, { matchup: string; eventDate: string | null; picks: TopEdgePick[] }>();
  for (const pick of picks) {
    const key = `${pick.matchup}|${pick.eventDate ?? ''}`;
    const current = map.get(key) ?? { matchup: pick.matchup, eventDate: pick.eventDate, picks: [] };
    current.picks.push(pick);
    map.set(key, current);
  }
  return [...map.values()];
}

export default function GameCenter({ onAsk }: { onAsk: (text: string) => void }) {
  const [sport, setSport] = useState<(typeof SPORTS)[number]>('NFL');
  const [draft, setDraft] = useState('');
  const [player, setPlayer] = useState('');
  const [report, setReport] = useState<InjuryReportPayload | null>(null);
  const [picks, setPicks] = useState<TopEdgePick[] | null>(null);
  const [injuryError, setInjuryError] = useState('');
  const [edgeError, setEdgeError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setInjuryError('');
    setEdgeError('');
    setReport(null);
    const injuries = fetchInjuries(sport, player)
      .then((value) => { if (!cancelled) setReport(value); })
      .catch((error: unknown) => { if (!cancelled) setInjuryError(error instanceof Error ? error.message : 'Injury report unavailable.'); });
    const edges = fetchPerformance()
      .then((value) => { if (!cancelled) setPicks(value.performance.insights.topEdges ?? []); })
      .catch((error: unknown) => { if (!cancelled) setEdgeError(error instanceof Error ? error.message : 'Stored recommendations unavailable.'); });
    void Promise.all([injuries, edges]).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [sport, player]);

  const matchups = useMemo(() => {
    const scoped = (picks ?? []).filter((pick) => pick.sport.toUpperCase() === sport);
    return groupByMatchup(scoped);
  }, [picks, sport]);

  const entries = (report?.entries ?? []).slice(0, 40);

  return (
    <div className="workspace-pad mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
      <header className="desk-heading">
        <p className="kicker">SportsEdge / Game Center</p>
        <h2 className="display mt-3 text-4xl text-head sm:text-5xl">Matchup context, only when it is real.</h2>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-frost2">
          Injuries come from the existing report. Market rows are stored recommendations, not a live board. Lineups, team form and weather are not exposed here, so they are not filled in.
        </p>
      </header>

      <form className="mt-6 flex flex-col gap-3 border-y border-line py-4 sm:flex-row sm:items-end" onSubmit={(event) => { event.preventDefault(); setPlayer(draft.trim()); }}>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Sport">
          {SPORTS.map((code) => (
            <button key={code} type="button" aria-pressed={sport === code} onClick={() => setSport(code)} className={`min-h-11 px-3 text-xs font-semibold ${sport === code ? 'bg-edge text-ink' : 'border border-line text-frost'}`}>{code}</button>
          ))}
        </div>
        <label className="min-w-0 flex-1 text-xs text-frost">
          Optional player filter
          <input value={draft} onChange={(event) => setDraft(event.target.value)} className="mt-1 min-h-11 w-full border border-line bg-panel px-3 text-sm text-head" placeholder="Leave blank for the sport report" />
        </label>
        <button type="submit" className="min-h-11 bg-edge px-4 text-sm font-bold text-ink">Load report</button>
      </form>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <section aria-label="Stored matchup context">
          <h3 className="text-lg font-semibold text-head">Stored matchup context</h3>
          <p className="mt-1 text-xs text-frost2">Grouped from priced positive-edge recommendations already on the desk. Quote age is recommendation age.</p>
          {edgeError && <p role="alert" className="mt-3 text-sm text-danger">{edgeError}</p>}
          {!edgeError && !loading && matchups.length === 0 && <p className="mt-4 text-sm text-frost2">No stored recommendations for {sport}.</p>}
          <ul className="mt-3 divide-y divide-line border-y border-line">
            {matchups.map((game) => (
              <li key={`${game.matchup}-${game.eventDate}`} className="py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="font-semibold text-head">{game.matchup || 'Matchup unavailable'}</p>
                  <p className="num text-xs text-frost2">{game.eventDate ?? 'Date unavailable'}</p>
                </div>
                <ul className="mt-2 space-y-1">
                  {game.picks.map((pick) => (
                    <li key={pick.predictionId + pick.selection} className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="min-w-0 truncate text-frost">{pick.selection}</span>
                      <span className="num shrink-0 text-edge">{pick.odds != null ? formatAmerican(pick.odds) : 'Unpriced'} · {quoteAge(pick.recommendedAt).label}</span>
                    </li>
                  ))}
                </ul>
                <button type="button" onClick={() => onAsk(`Review the ${sport} matchup ${game.matchup}. Use only verified injuries, availability and stored prices. Do not invent a lineup, weather or live number.`)} className="mt-2 min-h-11 text-xs font-semibold text-edge">Ask about this matchup</button>
              </li>
            ))}
          </ul>
        </section>

        <section aria-label="Injuries">
          <h3 className="text-lg font-semibold text-head">Injuries and availability</h3>
          {loading && <p className="mt-3 text-sm text-frost2">Loading the injury report…</p>}
          {injuryError && <p role="alert" className="mt-3 text-sm text-danger">{injuryError}</p>}
          {report && !report.available && !injuryError && (
            <p role="status" className="mt-3 text-sm text-warn">{report.reason || 'The injury report is unavailable. No statuses were invented.'}</p>
          )}
          {report?.unavailable && report.unavailable.length > 0 && (
            <ul className="mt-2 text-xs text-warn">
              {report.unavailable.map((item) => <li key={item.source}>{item.source}: {item.reason}</li>)}
            </ul>
          )}
          {report?.sources && report.sources.length > 0 && <p className="mt-2 text-xs text-frost2">Sources: {report.sources.join(', ')}{report.checkedAt ? ` · checked ${report.checkedAt}` : ''}</p>}
          <ul className="mt-3 max-h-[32rem] divide-y divide-line overflow-y-auto border-y border-line">
            {entries.map((entry) => <InjuryRow key={`${entry.playerName}-${entry.designationRaw}-${entry.source}`} entry={entry} />)}
          </ul>
          {report?.available && entries.length === 0 && <p className="mt-3 text-sm text-frost2">The report returned no entries for this filter.</p>}
        </section>
      </div>

      <section className="mt-8 grid gap-px bg-line sm:grid-cols-3" aria-label="Not yet available">
        {[
          ['Projected lineup', 'No lineup endpoint is wired into this screen.'],
          ['Recent team form', 'Team-level form is not returned by the current research routes.'],
          ['Weather', 'Weather stays inside analyst tools. This screen will not guess conditions.'],
        ].map(([title, body]) => (
          <div key={title} className="bg-ink p-4">
            <p className="kicker">Not yet on this screen</p>
            <h3 className="mt-2 font-semibold text-head">{title}</h3>
            <p className="mt-1 text-sm leading-relaxed text-frost2">{body}</p>
          </div>
        ))}
      </section>
    </div>
  );
}

function InjuryRow({ entry }: { entry: InjuryEntry }) {
  return (
    <li className="py-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-semibold text-head">{entry.playerName}</p>
        <p className={`text-xs font-semibold ${entry.unavailable ? 'text-danger' : 'text-warn'}`}>{entry.designationRaw || entry.designation}</p>
      </div>
      <p className="mt-1 text-xs text-frost2">
        {[entry.team, entry.position, entry.injury].filter(Boolean).join(' · ') || 'Detail unpublished'}
        {entry.source ? ` · ${entry.source}` : ''}
      </p>
      {entry.shortComment && <p className="mt-1 text-sm text-frost">{entry.shortComment}</p>}
    </li>
  );
}
