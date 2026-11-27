import * as mlb from '../providers/mlbStatsApi.js';
import * as espn from '../providers/espn.js';
import { espnObservation, mlbObservation, type ModelSport } from '../models/playerPropModel.js';
import { loadCandidateHistory, updateCandidateOutcomes, type CandidateHistoryRecord } from './candidateHistory.js';

const ESPN_MAP: Record<Exclude<ModelSport, 'mlb'>, espn.EspnSport> = {
  nba: 'basketball/nba', nfl: 'football/nfl', nhl: 'hockey/nhl',
};

function outcome(actual: number, line: number, side: 'over' | 'under'): 'won' | 'lost' | 'push' {
  if (actual === line) return 'push';
  return (actual > line) === (side === 'over') ? 'won' : 'lost';
}

async function gradeMlb(row: CandidateHistoryRecord): Promise<number | null> {
  const found = row.playerId == null ? (await mlb.searchPlayer(row.player)).data?.id : Number(row.playerId);
  if (!found || !Number.isSafeInteger(found)) return null;
  const pitchingMarkets = new Set(['strikeouts', 'outsRecorded', 'earnedRuns', 'hitsAllowed', 'walksAllowed']);
  const group = pitchingMarkets.has(row.market) ? 'pitching' : 'hitting';
  const log = await mlb.getGameLog(found, group, mlb.CURRENT_SEASON, 30);
  if (!log.available || !Array.isArray(log.data)) return null;
  const game = log.data.find((entry: any) => row.eventId != null
    ? String(entry.game?.gamePk ?? entry.gamePk ?? '') === String(row.eventId)
    : String(entry.date ?? '').slice(0, 10) === row.eventDate);
  if (!game) return null;
  return mlbObservation(row.market, game.stat ?? {});
}

async function gradeEspn(row: CandidateHistoryRecord, sport: Exclude<ModelSport, 'mlb'>): Promise<number | null> {
  const playerId = row.playerId == null ? (await espn.findPlayer(row.player, ESPN_MAP[sport])).player?.id : String(row.playerId);
  if (!playerId) return null;
  const log = await espn.getGamelog(playerId, ESPN_MAP[sport], 30);
  if (!log.available || !Array.isArray(log.games)) return null;
  const game = log.games.find(entry => row.eventId != null
    ? String(entry.gameId) === String(row.eventId)
    : String(entry.gameDate ?? '').slice(0, 10) === row.eventDate);
  if (!game || (row.price && !game.result && !game.score)) return null;
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
  const now = options.now ?? new Date();
  const today = now.toISOString().slice(0, 10);
  const history = await loadCandidateHistory();
  const pendingRows = history.filter(row => row.outcome === 'pending' && (
    row.price ? now.getTime() - Date.parse(row.price.eventStart) >= 6 * 60 * 60 * 1000 : row.eventDate < today
  ))
    .sort((a, b) => Number(Boolean(b.price)) - Number(Boolean(a.price)) || b.eventDate.localeCompare(a.eventDate))
    .slice(0, limit);
  let processed = 0;
  const patches: Parameters<typeof updateCandidateOutcomes>[0] = [];

  for (const row of pendingRows) {
    if (Date.now() - started >= budget) break;
    processed++;
    try {
      const actual = row.sport === 'mlb'
        ? await gradeMlb(row)
        : await gradeEspn(row, row.sport as Exclude<ModelSport, 'mlb'>);
      if (actual == null) continue;
      patches.push({ id: row.id, actual, outcome: outcome(actual, row.line, row.side) });
    } catch {
      // Keep pending and retry on a later evaluation window.
    }
  }

  const graded = await updateCandidateOutcomes(patches);
  const remaining = (await loadCandidateHistory()).filter((row) => row.outcome === 'pending').length;
  return { processed, graded, pending: remaining };
}
