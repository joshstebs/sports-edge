import * as mlb from '../providers/mlbStatsApi.js';
import * as espn from '../providers/espn.js';
import { discoverPlayersForEvent, discoverSlateEvents, type DiscoveredPlayer } from '../providers/slateDiscovery.js';
import { buildPlayerPropModel, espnObservation, mlbObservation, normalizeMarket, type HistoricalObservation, type ModelSport } from '../models/playerPropModel.js';
import { featureWindow, type PlayerFeatureProfile } from '../candidates/featureProfile.js';
import { recordCandidateEvaluations } from '../candidates/candidateHistory.js';
import { loadLearning } from '../lib/predictionStore.js';
import type { ToolDef, ToolOutcome } from './tools.js';

const ESPN_MAP: Record<Exclude<ModelSport, 'mlb'>, espn.EspnSport> = {
  nba: 'basketball/nba', nfl: 'football/nfl', nhl: 'hockey/nhl',
};

type CachedHistory = {
  source: string;
  season: Record<string, unknown>;
  games: any[];
  mode: 'mlb' | 'espn';
};

function ok(summary: string, payload: any): ToolOutcome {
  return { available: true, summary, data: payload, payload };
}
function unavailable(reason: string): ToolOutcome {
  return { available: false, reason, summary: `unavailable: ${reason}`, data: { available: false, reason }, payload: { available: false, reason } };
}
function todayToronto(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function requestedDate(value: unknown): string {
  const text = String(value ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : todayToronto();
}
function usableEvent(status: string | null): boolean {
  const value = String(status ?? '').toLowerCase();
  return !['final', 'completed', 'postponed', 'canceled', 'cancelled'].some((token) => value.includes(token));
}
function marketsFor(player: DiscoveredPlayer, sport: ModelSport): string[] {
  const pos = String(player.position ?? '').toUpperCase();
  if (sport === 'mlb') {
    const pitcher = player.probablePitcher || pos.includes('P');
    return pitcher ? ['strikeouts', 'outsRecorded'] : ['hits', 'totalBases'];
  }
  if (sport === 'nba') return ['points', 'rebounds'];
  if (sport === 'nfl') {
    if (pos === 'QB') return ['passingYards', 'passingTouchdowns'];
    if (pos === 'RB' || pos === 'FB') return ['rushingYards', 'receptions'];
    return ['receivingYards', 'receptions'];
  }
  if (['G', 'GOALIE'].includes(pos)) return ['saves'];
  return ['shotsOnGoal', 'hockeyPoints'];
}
function balanced(groups: DiscoveredPlayer[][], limit: number): DiscoveredPlayer[] {
  const queues = groups.map((rows) => {
    const away = rows.filter((row) => row.homeAway === 'away');
    const home = rows.filter((row) => row.homeAway === 'home');
    const mixed: DiscoveredPlayer[] = [];
    while (away.length || home.length) {
      const a = away.shift(); if (a) mixed.push(a);
      const h = home.shift(); if (h) mixed.push(h);
    }
    return mixed;
  });
  const out: DiscoveredPlayer[] = [];
  while (out.length < limit && queues.some((q) => q.length)) {
    for (const queue of queues) {
      if (out.length >= limit) break;
      const row = queue.shift(); if (row) out.push(row);
    }
  }
  return out;
}
async function loadPlayerHistory(player: DiscoveredPlayer, sport: ModelSport): Promise<CachedHistory | null> {
  if (sport === 'mlb') {
    const found = await mlb.searchPlayer(player.name);
    if (!found.available || !found.data) return null;
    const pitching = player.probablePitcher || String(player.position ?? '').toUpperCase().includes('P');
    const log = await mlb.getGameLog(found.data.id, pitching ? 'pitching' : 'hitting', mlb.CURRENT_SEASON, 20);
    if (!log.available || !Array.isArray(log.data)) return null;
    return { source: 'statsapi.mlb.com', season: { playerId: found.data.id, season: mlb.CURRENT_SEASON }, games: log.data, mode: 'mlb' };
  }
  const s = sport as Exclude<ModelSport, 'mlb'>;
  let playerId = player.id != null ? String(player.id) : '';
  if (!playerId) {
    const found = await espn.findPlayer(player.name, ESPN_MAP[s]);
    if (!found.available || !found.player) return null;
    playerId = found.player.id;
  }
  const log = await espn.getGamelog(playerId, ESPN_MAP[s], 20);
  if (!log.available || !Array.isArray(log.games)) return null;
  return { source: 'site.web.api.espn.com', season: { season: log.season ?? null }, games: log.games, mode: 'espn' };
}
function observations(history: CachedHistory, sport: ModelSport, market: string): HistoricalObservation[] {
  return history.games.map((game: any) => {
    const value = history.mode === 'mlb'
      ? mlbObservation(market, game.stat ?? {})
      : espnObservation(sport as Exclude<ModelSport, 'mlb'>, market, game.stats ?? {});
    if (value == null) return null;
    return { date: game.date ?? game.gameDate ?? null, value };
  }).filter(Boolean) as HistoricalObservation[];
}
function halfLine(rows: HistoricalObservation[]): number {
  const mean = rows.reduce((sum, row) => sum + row.value, 0) / rows.length;
  let line = Math.round(mean * 2) / 2;
  if (Number.isInteger(line)) line += 0.5;
  return Math.max(0.5, line);
}

/**
 * Run an async mapper over items with a bounded concurrency. The screener fans
 * out player-history fetches; firing ~25 × 2-3 HTTP calls all at once
 * (Promise.all) stalls on rate limits and blows the tool timeout in serverless.
 * Capping concurrency (default 6) keeps wall time low while never overloading
 * upstream providers.
 */
async function mapConcurrent<T, U>(items: T[], limit: number, fn: (item: T) => Promise<U>): Promise<U[]> {
  const out: U[] = new Array(items.length);
  let idx = 0;
  async function worker(): Promise<void> {
    while (idx < items.length) {
      const current = idx++;
      out[current] = await fn(items[current]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length || 1) }, () => worker()));
  return out;
}
function calibrationFor(learning: Awaited<ReturnType<typeof loadLearning>>, sport: ModelSport, market: string) {
  if (!learning) return null;
  const keys = [`${sport}:${market}`, `${sport.toUpperCase()}:${market}`, `${sport}|${market}`, market];
  for (const key of keys) {
    const row = learning.perSportMarket?.[key] ?? learning.perMarket?.[key];
    if (row) return { n: row.n, averageConfidence: row.averageConfidence ?? null, hitRate: row.hitRate };
  }
  return null;
}

const handler = async (args: any): Promise<ToolOutcome> => {
  const sport = String(args?.sport ?? 'mlb').toLowerCase() as ModelSport;
  if (!['mlb', 'nba', 'nfl', 'nhl'].includes(sport)) return unavailable(`unsupported sport ${sport}`);
  const date = requestedDate(args?.date);
  const requested = Math.min(10, Math.max(1, Number(args?.requestedPicks ?? 5) || 5));
  // Pull a WIDER pool than the final pick count so "more/other" requests can
  // surface genuinely different athletes instead of re-ranking the same five.
  const maxPlayers = Math.min(14, Math.max(8, Number(args?.maxPlayers ?? Math.max(8, requested * 2)) || 8));
  const minConfidence = Math.max(0.5, Math.min(0.75, Number(args?.minConfidence ?? 0.54) || 0.54));
  const excludeNames = new Set<string>(
    Array.isArray(args?.exclude)
      ? args.exclude.map((n: any) => String(n ?? '').toLowerCase()).filter(Boolean)
      : String(args?.exclude ?? '').split(',').map((s: string) => s.trim().toLowerCase()).filter(Boolean),
  );

  const events = (await discoverSlateEvents(sport, date)).filter((event) => usableEvent(event.status));
  if (!events.length) return unavailable(`no upcoming ${sport.toUpperCase()} events found for ${date}`);
  // Bound slate scope: on a busy day there can be 10-15+ events; processing all
  // with per-player history fetches exceeds the tool budget. Screen the first
  // N usable events (balanced across the slate) and keep the pool tight.
  const maxEvents = Math.min(Number(args?.maxEvents ?? 6) || 6, events.length);
  const scopedEvents = events.slice(0, maxEvents);
  const groups = await mapConcurrent(scopedEvents, 4, async (event) =>
    (await discoverPlayersForEvent(event, excludeNames).catch(() => [])) as DiscoveredPlayer[]
  );
  const players = balanced(groups, maxPlayers);
  if (!players.length) return unavailable(`no roster candidates discovered for ${sport.toUpperCase()} slate${excludeNames.size ? ' after excluding prior picks' : ''}`);

  const learning = await loadLearning().catch(() => null);
  const evaluated: any[] = [];
  await mapConcurrent(players, 6, async (player) => {
    const history = await loadPlayerHistory(player, sport).catch(() => null);
    if (!history) return;
    for (const market of marketsFor(player, sport)) {
      const rows = observations(history, sport, market);
      if (rows.length < 5) continue;
      const line = halfLine(rows);
      const calibration = calibrationFor(learning, sport, normalizeMarket(market));
      const over = buildPlayerPropModel({ sport, market, side: 'over', line, observations: rows, source: history.source, calibration });
      const under = buildPlayerPropModel({ sport, market, side: 'under', line, observations: rows, source: history.source, calibration });
      const model = [over, under].filter((x) => x.available && x.probability != null).sort((a, b) => (b.probability ?? 0) - (a.probability ?? 0))[0];
      if (!model?.available || model.probability == null || !model.grade) continue;
      const values = rows.map((row) => row.value);
      const profile: PlayerFeatureProfile = {
        sport, player: player.name, team: player.team, opponent: player.opponent,
        eventId: player.eventId, eventDate: player.eventDate, role: player.position,
        availability: {
          status: sport === 'mlb' && player.lineupSlot == null && !player.probablePitcher ? 'provisional' : 'unknown',
          reason: sport === 'mlb' && player.lineupSlot == null && !player.probablePitcher ? 'active roster candidate; final lineup still required' : 'final availability gate still required',
        },
        recent: { last5: featureWindow(values, line, 5), last10: featureWindow(values, line, 10), last20: featureWindow(values, line, 20) },
        season: history.season, matchup: { opponent: player.opponent },
        context: { homeAway: player.homeAway, restDays: null, expectedPlayingTime: null, lineupSlot: player.lineupSlot, weather: null, venueFactor: null },
        market: { market: normalizeMarket(market), suggestedLine: line, side: model.side, modelProbability: model.probability, grade: model.grade, sampleSize: model.sampleSize, impliedProbability: null, estimatedEdge: null, modelVersion: model.modelVersion },
        sources: [...new Set([history.source, player.source])], fallbackUsed: sport !== 'mlb', retrievedAt: new Date().toISOString(),
      };
      evaluated.push({ player, market: normalizeMarket(market), line, model, profile, source: history.source });
    }
  });

  if (!evaluated.length) return unavailable(`no supported ${sport.toUpperCase()} markets had enough recent-game history`);
  await recordCandidateEvaluations(evaluated.map(({ player, market, line, model, profile, source }) => ({
    eventDate: player.eventDate, eventId: player.eventId, sport, player: player.name, team: player.team, opponent: player.opponent,
    market, side: model.side, line, modelProbability: model.probability, grade: model.grade, sampleSize: model.sampleSize,
    modelVersion: model.modelVersion, modelSource: source, sources: profile.sources, fallbackUsed: sport !== 'mlb',
    metadata: { lineupSlot: player.lineupSlot, availability: profile.availability },
  }))).catch(() => {});

  const qualified = evaluated
    .filter(({ model }) => model.grade !== 'D' && (model.probability ?? 0) >= minConfidence)
    .sort((a, b) => (b.model.probability ?? 0) - (a.model.probability ?? 0) || b.model.sampleSize - a.model.sampleSize);

  // One leg per player: keep each player's single best market so a parlay never
  // double-counts the same athlete. Also record whether the player is actually
  // in TODAY'S posted lineup (batting order or confirmed probable pitcher) —
  // roster-fallback guesses are not startable/bettable until lineups post.
  const seenPlayer = new Set<string>();
  const deduped = qualified.filter(({ player }) => {
    const key = `${player.name}|${player.team}`.toLowerCase();
    if (seenPlayer.has(key)) return false;
    seenPlayer.add(key);
    return true;
  });
  const inLineup = (player: DiscoveredPlayer) => player.lineupSlot != null || player.probablePitcher;
  deduped.sort((a, b) => Number(inLineup(b.player)) - Number(inLineup(a.player)) || (b.model.probability ?? 0) - (a.model.probability ?? 0));

  const lineupPosted = evaluated.some(({ player }) => inLineup(player));

  const candidates = deduped.slice(0, Math.max(12, requested * 2)).map(({ player, market, line, model, profile, source }) => ({
    player: player.name, team: player.team, opponent: player.opponent, eventId: player.eventId, eventDate: player.eventDate,
    market, side: model.side, suggestedLine: line, confidencePct: Math.round((model.probability ?? 0) * 1000) / 10,
    grade: model.grade, sampleSize: model.sampleSize,
    // Trimmed for LLM context: full history windows live in the PREDICTION_LOG
    // (separate, persisted) so the synthesis turn stays small enough to finish
    // inside the 60s function budget. Keep only a compact hit-rate summary.
    availability: profile.availability,
    inLineupToday: inLineup(player),
    lineupSlot: player.lineupSlot,
    recentHitRate: {
      last5: profile.recent?.last5?.hitRateOverSuggestedLine,
      last10: profile.recent?.last10?.hitRateOverSuggestedLine,
      last20: profile.recent?.last20?.hitRateOverSuggestedLine,
    },
    note: 'Fast slate-screen candidate. Verify the exact current sportsbook line/odds and final availability before treating as a final recommendation.',
  }));

  const payload: any = { available: true, sport, date, slate: { events: events.length, discoveredPlayers: players.length, modelEvaluations: evaluated.length, qualifiedCandidates: deduped.length, lineupPosted }, candidates, providerPolicy: { apiSportsRequired: false, fallbackRule: 'MLB uses MLB Stats API; NBA/NFL/NHL use ESPN recent game logs.' } };
  if (!lineupPosted) payload.warning = 'Batting orders have NOT been posted for this date yet. Candidates below come from current rosters/probable pitchers and are NOT confirmable starters. Re-run closer to game time once lineups post.';
  return ok(
    `${sport.toUpperCase()} fast screener evaluated ${evaluated.length} markets across ${players.length} players; ${deduped.length} cleared ${Math.round(minConfidence * 100)}%${lineupPosted ? '' : ' (lineups not posted)'}`,
    payload,
  );
};

export const FAST_SLATE_SCREENER_TOOL: ToolDef = {
  name: 'slate_candidate_screener',
  description: 'Fast slate-wide MLB/NBA/NFL/NHL candidate screener for multi-pick requests. It balances players across games/teams, fetches each player history once, evaluates a small set of high-value markets, stores every candidate for calibration, and is designed to finish inside the agent tool timeout. Final picks still require exact current line/odds and availability verification.',
  parameters: {
    type: 'object',
    properties: {
      sport: { type: 'string', enum: ['mlb', 'nba', 'nfl', 'nhl'] },
      date: { type: 'string', description: 'YYYY-MM-DD; defaults to today in America/Toronto' },
      requestedPicks: { type: 'number' },
      maxPlayers: { type: 'number', description: '8-16 players; defaults to roughly 2x requested picks plus two' },
      maxEvents: { type: 'number', description: 'Screen at most this many events (default 6) to stay inside the tool timeout; balanced across the slate' },
      minConfidence: { type: 'number', description: 'Decimal; default 0.54' },
    },
    required: ['sport'],
  },
  handler,
};
