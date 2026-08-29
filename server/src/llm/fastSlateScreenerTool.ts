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

type RequestedSide = 'over' | 'under';

const SPORT_MARKETS: Record<ModelSport, string[]> = {
  mlb: ['hits', 'totalBases', 'strikeouts', 'outsRecorded'],
  nba: ['points', 'rebounds'],
  nfl: ['passingYards', 'passingTouchdowns', 'rushingYards', 'receivingYards', 'receptions'],
  nhl: ['shotsOnGoal', 'hockeyPoints', 'saves'],
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
function requestedSide(value: unknown): RequestedSide | null {
  const side = String(value ?? '').trim().toLowerCase();
  return side === 'over' || side === 'under' ? side : null;
}
function requestedMarket(value: unknown, sport: ModelSport): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const normalized = normalizeMarket(raw);
  return SPORT_MARKETS[sport].includes(normalized) ? normalized : null;
}
function marketsFor(player: DiscoveredPlayer, sport: ModelSport, marketFilter: string | null): string[] {
  const pos = String(player.position ?? '').toUpperCase();
  let markets: string[];
  if (sport === 'mlb') {
    const pitcher = player.probablePitcher || pos.includes('P');
    markets = pitcher ? ['strikeouts', 'outsRecorded'] : ['hits', 'totalBases'];
  } else if (sport === 'nba') {
    markets = ['points', 'rebounds'];
  } else if (sport === 'nfl') {
    if (pos === 'QB') markets = ['passingYards', 'passingTouchdowns'];
    else if (pos === 'RB' || pos === 'FB') markets = ['rushingYards', 'receptions'];
    else markets = ['receivingYards', 'receptions'];
  } else if (['G', 'GOALIE'].includes(pos)) {
    markets = ['saves'];
  } else {
    markets = ['shotsOnGoal', 'hockeyPoints'];
  }
  return marketFilter ? markets.filter((market) => market === marketFilter) : markets;
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
function spreadEvents<T>(events: T[], limit: number): T[] {
  if (events.length <= limit) return events;
  if (limit <= 1) return events.slice(0, 1);
  const picked: T[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < limit; i++) {
    const index = Math.round((i * (events.length - 1)) / (limit - 1));
    if (!seen.has(index)) {
      seen.add(index);
      picked.push(events[index]);
    }
  }
  return picked;
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
function sideHitRate(overRate: number | null | undefined, side: RequestedSide): number | null | undefined {
  if (overRate == null) return overRate;
  return side === 'over' ? overRate : Math.max(0, Math.min(1, 1 - overRate));
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
  const rawMarket = String(args?.market ?? '').trim();
  const marketFilter = requestedMarket(rawMarket, sport);
  if (rawMarket && !marketFilter) {
    return unavailable(`unsupported ${sport.toUpperCase()} market ${rawMarket}; supported fast-screen markets: ${SPORT_MARKETS[sport].join(', ')}`);
  }
  const rawSide = String(args?.side ?? '').trim();
  const sideFilter = requestedSide(rawSide);
  if (rawSide && !sideFilter) return unavailable(`unsupported side ${rawSide}; expected over or under`);
  const constrained = Boolean(marketFilter || sideFilter);
  // Pull a wider pool for market/side-specific requests. Filtering to one market
  // or one direction naturally removes many generic top candidates, so screen
  // enough distinct athletes to have a fair chance of satisfying 5-6 pick asks.
  const defaultPlayers = constrained ? Math.max(12, requested * 3) : Math.max(8, requested * 2);
  const maxPlayersCap = constrained ? 22 : 14;
  const maxPlayers = Math.min(maxPlayersCap, Math.max(8, Number(args?.maxPlayers ?? defaultPlayers) || defaultPlayers));
  const minConfidence = Math.max(0.5, Math.min(0.75, Number(args?.minConfidence ?? 0.54) || 0.54));
  const excludeNames = new Set<string>(
    Array.isArray(args?.exclude)
      ? args.exclude.map((n: any) => String(n ?? '').toLowerCase()).filter(Boolean)
      : String(args?.exclude ?? '').split(',').map((s: string) => s.trim().toLowerCase()).filter(Boolean),
  );

  const events = (await discoverSlateEvents(sport, date)).filter((event) => usableEvent(event.status));
  if (!events.length) return unavailable(`no upcoming ${sport.toUpperCase()} events found for ${date}`);
  // Bound slate scope while sampling across the entire day instead of only the
  // first games. This keeps the same timeout discipline without systematically
  // ignoring later games that may contain stronger requested-market candidates.
  const defaultMaxEvents = constrained ? 8 : 6;
  const maxEvents = Math.min(Number(args?.maxEvents ?? defaultMaxEvents) || defaultMaxEvents, events.length);
  const scopedEvents = spreadEvents(events, maxEvents);
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
    for (const market of marketsFor(player, sport, marketFilter)) {
      const rows = observations(history, sport, market);
      if (rows.length < 5) continue;
      const line = halfLine(rows);
      const calibration = calibrationFor(learning, sport, normalizeMarket(market));
      const sides: RequestedSide[] = sideFilter ? [sideFilter] : ['over', 'under'];
      const models = sides
        .map((side) => buildPlayerPropModel({ sport, market, side, line, observations: rows, source: history.source, calibration }))
        .filter((x) => x.available && x.probability != null)
        .sort((a, b) => (b.probability ?? 0) - (a.probability ?? 0));
      const model = models[0];
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

  const filterLabel = [marketFilter, sideFilter?.toUpperCase()].filter(Boolean).join(' ');
  if (!evaluated.length) return unavailable(`no supported ${sport.toUpperCase()} ${filterLabel || 'markets'} had enough recent-game history`);
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
  // double-counts the same athlete. With an explicit market filter, this simply
  // deduplicates athletes while preserving the requested market and side.
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

  const candidates = deduped.slice(0, Math.max(12, requested * 2)).map(({ player, market, line, model, profile }) => ({
    player: player.name, team: player.team, opponent: player.opponent, eventId: player.eventId, eventDate: player.eventDate,
    market, side: model.side, suggestedLine: line, confidencePct: Math.round((model.probability ?? 0) * 1000) / 10,
    grade: model.grade, sampleSize: model.sampleSize,
    // Side-aware form rates: the old renderer always showed the OVER hit rate,
    // even beside an UNDER recommendation, which made those summaries internally
    // inconsistent. Half-lines cannot push, so UNDER rate = 1 - OVER rate.
    availability: profile.availability,
    inLineupToday: inLineup(player),
    lineupSlot: player.lineupSlot,
    recentHitRate: {
      last5: sideHitRate(profile.recent?.last5?.hitRateOverSuggestedLine, model.side),
      last10: sideHitRate(profile.recent?.last10?.hitRateOverSuggestedLine, model.side),
      last20: sideHitRate(profile.recent?.last20?.hitRateOverSuggestedLine, model.side),
    },
    note: 'Fast slate-screen candidate. Verify the exact current sportsbook line/odds and final availability before treating as a final recommendation.',
  }));

  const payload: any = {
    available: true,
    sport,
    date,
    requestFilters: { market: marketFilter, side: sideFilter },
    slate: { events: events.length, screenedEvents: scopedEvents.length, discoveredPlayers: players.length, modelEvaluations: evaluated.length, qualifiedCandidates: deduped.length, lineupPosted },
    candidates,
    providerPolicy: { apiSportsRequired: false, fallbackRule: 'MLB uses MLB Stats API; NBA/NFL/NHL use ESPN recent game logs.' },
  };
  if (!lineupPosted) payload.warning = 'Batting orders have NOT been posted for this date yet. Candidates below come from current rosters/probable pitchers and are NOT confirmable starters. Re-run closer to game time once lineups post.';
  return ok(
    `${sport.toUpperCase()} fast screener${filterLabel ? ` (${filterLabel})` : ''} evaluated ${evaluated.length} markets across ${players.length} players; ${deduped.length} cleared ${Math.round(minConfidence * 100)}%${lineupPosted ? '' : ' (lineups not posted)'}`,
    payload,
  );
};

export const FAST_SLATE_SCREENER_TOOL: ToolDef = {
  name: 'slate_candidate_screener',
  description: 'Fast slate-wide MLB/NBA/NFL/NHL candidate screener for multi-pick requests. IMPORTANT: when the user names a prop market and/or direction, pass market and side so every returned candidate matches the request (example: market="totalBases", side="over"). It balances players across games/teams, fetches each player history once, stores every candidate for calibration, and is designed to finish inside the agent tool timeout. Final picks still require exact current line/odds and availability verification.',
  parameters: {
    type: 'object',
    properties: {
      sport: { type: 'string', enum: ['mlb', 'nba', 'nfl', 'nhl'] },
      date: { type: 'string', description: 'YYYY-MM-DD; defaults to today in America/Toronto' },
      requestedPicks: { type: 'number', description: 'How many picks the user asked for' },
      market: { type: 'string', description: 'Optional exact requested prop market. Preserve the user request; e.g. total bases -> totalBases, hits -> hits, strikeouts -> strikeouts.' },
      side: { type: 'string', enum: ['over', 'under'], description: 'Optional requested direction. If the user asks for OVER bets, pass over; if UNDER, pass under. Never omit an explicit user direction.' },
      exclude: { type: 'array', items: { type: 'string' }, description: 'Optional player names to exclude, especially for more/other/different follow-ups.' },
      maxPlayers: { type: 'number', description: '8-22 players; constrained market/side requests automatically screen a wider pool' },
      maxEvents: { type: 'number', description: 'Screen at most this many events (default 6 generic, 8 when market/side constrained) sampled across the slate' },
      minConfidence: { type: 'number', description: 'Decimal; default 0.54' },
    },
    required: ['sport'],
  },
  handler,
};
