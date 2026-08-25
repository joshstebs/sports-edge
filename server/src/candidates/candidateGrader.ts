import * as mlb from '../providers/mlbStatsApi.js';
import * as espn from '../providers/espn.js';
import { espnObservation, mlbObservation, type ModelSport } from '../models/playerPropModel.js';
import { loadCandidateHistory, updateCandidateOutcome, type CandidateHistoryRecord } from './candidateHistory.js';

const ESPN_MAP: Record<Exclude<ModelSport, 'mlb'>, espn.EspnSport> = {
  nba: 'basketball/nba', nfl: 'football/nfl', nhl: 'hockey/nhl',
};

function outcome(actual: number, line: number, side: 'over' | 'under'): 'won' | 'lost' | 'push' {
  if (actual === line) return 'push';
  return (actual > line) === (side === 'over') ? 'won' : 'lost';
}

async function gradeMlb(row: CandidateHistoryRecord): Promise<number | null> {
  const found = await mlb.searchPlayer(row.player);
  if (!found.available || !found.data) return null;
  const pitchingMarkets = new Set(['strikeouts', 'outsRecorded', 'earnedRuns', 'hitsAllowed', 'walksAllowed']);
  const group = pitchingMarkets.has(row.market) ? 'pitching' : 'hitting';
  const log = await mlb.getGameLog(found.data.id, group, mlb.CURRENT_SEASON, 30);
  if (!log.available || !Array.isArray(log.data)) return null;
  const game = log.data.find((entry: any) => String(entry.date ?? '').slice(0, 10) === row.eventDate);
  if (!game) return null;
  return mlbObservation(row.market, game.stat ?? {});
}

async function gradeEspn(row: CandidateHistoryRecord, sport: Exclude<ModelSport, 'mlb'>): Promise<number | null> {
  const found = await espn.findPlayer(row.player, ESPN_MAP[sport]);
  if (!found.available || !found.player) return null;
  const log = await espn.getGamelog(found.player.id, ESPN_MAP[sport], 30);
  if (!log.available || !Array.isArray(log.games)) return null;
  const game = log.games.find((entry: any) => String(entry.date ?? entry.gameDate ?? '').slice(0, 10) === row.eventDate);
  if (!game) return null;
  return espnObservation(sport, row.market, game.stats ?? {});
}

export async function gradePendingCandidateHistory(options: {
  limit?: number;
  timeBudgetMs?: number;
  now?: Date;
} = {}): Promise<{ processed: number; graded: number; pending: number }> {
  const limit = Math.max(1, Math.min(50, options.limit ?? 12));
  const budget = Math.max(1000, options.timeBudgetMs ?? 10_000);
  const started = Date.now();
  const today = (options.now ?? new Date()).toISOString().slice(0, 10);
  const history = await loadCandidateHistory();
  const pendingRows = history.filter((row) => row.outcome === 'pending' && row.eventDate < today).slice(0, limit);
  let processed = 0;
  let graded = 0;

  for (const row of pendingRows) {
    if (Date.now() - started >= budget) break;
    processed++;
    try {
      const actual = row.sport === 'mlb'
        ? await gradeMlb(row)
        : await gradeEspn(row, row.sport as Exclude<ModelSport, 'mlb'>);
      if (actual == null) continue;
      await updateCandidateOutcome(row.id, { actual, outcome: outcome(actual, row.line, row.side) });
      graded++;
    } catch {
      // Keep pending and retry on a later evaluation window.
    }
  }

  const remaining = (await loadCandidateHistory()).filter((row) => row.outcome === 'pending').length;
  return { processed, graded, pending: remaining };
}
