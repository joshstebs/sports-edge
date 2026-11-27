import type { PlayerResearchObservation } from './api';

const MIN_REPLAY_DECISIONS = 8;
const MIN_REPLAY_DATES = 5;
const MAX_WINDOW_GAP = 0.15;
const WINDOWS = [5, 10] as const;

type Decision = 0 | 1;
type Window = typeof WINDOWS[number];
type Forecasts = Record<Window, number>;
type ReplayDecision = { date: string; result: 0 | 1; estimates: Forecasts };

function datedGames(observations: PlayerResearchObservation[], before: string): PlayerResearchObservation[] {
  const seen = new Set<string>();
  return [...observations]
    .filter(game => {
      const day = game.date?.slice(0, 10) ?? '';
      return /^\d{4}-\d{2}-\d{2}$/.test(day) && day < before && Number.isFinite(game.value);
    })
    .sort((a, b) => a.date!.localeCompare(b.date!) || (a.gameId ?? '').localeCompare(b.gameId ?? ''))
    .filter(game => {
      const key = game.gameId ? `id:${game.gameId}` : `date:${game.date!.slice(0, 10)}:${game.opponent ?? ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function estimate(history: Decision[], count: Window): number {
  const wins = history.slice(-count).reduce<number>((total, result) => total + result, 0);
  // Beta(2,2) prior keeps a short streak from implying 0% or 100%.
  return (wins + 2) / (count + 4);
}

function brier(rows: ReplayDecision[], window: Window): number | null {
  if (rows.length === 0) return null;
  return rows.reduce((score, row) => score + (row.estimates[window] - row.result) ** 2, 0) / rows.length;
}

function averageMinutes(games: PlayerResearchObservation[]) {
  const minutes = games.flatMap(game => game.minutes != null && Number.isFinite(game.minutes) && game.minutes > 0 ? [game.minutes] : []);
  return minutes.length < 3 ? null : {
    sample: minutes.length,
    average: minutes.reduce((sum, value) => sum + value, 0) / minutes.length,
  };
}

export function evaluatePropStrategy(
  observations: PlayerResearchObservation[],
  line: number,
  side: 'over' | 'under',
  before: string,
) {
  const games = Number.isFinite(line) && line >= 0 ? datedGames(observations, before) : [];
  const decisions: Decision[] = [];
  const replay: ReplayDecision[] = [];
  let pushes = 0;
  let day = '';
  let dayStart = 0;

  for (const game of games) {
    const date = game.date!.slice(0, 10);
    if (date !== day) {
      day = date;
      dayStart = decisions.length;
    }
    if (game.value === line) {
      pushes++;
      continue;
    }
    const result = Number(side === 'over' ? game.value > line : game.value < line) as 0 | 1;
    if (dayStart >= 10) {
      const history = decisions.slice(0, dayStart);
      replay.push({ date, result, estimates: { 5: estimate(history, 5), 10: estimate(history, 10) } });
    }
    decisions.push(result);
  }

  const strategies = WINDOWS.map(window => ({
    window,
    estimate: decisions.length >= window ? estimate(decisions, window) : null,
    brier: brier(replay, window),
  }));
  const replayDates = new Set(replay.map(row => row.date)).size;
  const enough = replay.length >= MIN_REPLAY_DECISIONS && replayDates >= MIN_REPLAY_DATES;
  const short = strategies[0].estimate;
  const long = strategies[1].estimate;
  const bothImprove = strategies.every(strategy => strategy.brier != null && strategy.brier < 0.25);
  const estimateForQuotes = enough && bothImprove && short != null && long != null
    && Math.abs(short - long) < MAX_WINDOW_GAP ? Math.min(short, long) : null;

  return {
    strategies,
    replay, replayDates, pushes, estimateForQuotes,
    minutes: {
      recent: averageMinutes(games.slice(-5)),
      previous: averageMinutes(games.slice(-10, -5)),
    },
    status: !enough ? 'thin' as const : estimateForQuotes === null ? 'weak' as const : 'supported' as const,
  };
}
