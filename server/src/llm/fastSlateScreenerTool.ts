import * as mlb from '../providers/mlbStatsApi.js';
import * as espn from '../providers/espn.js';
import { normalizeName } from '../providers/http.js';
import { isBlockingInjuryStatus } from '../models/injuryStatus.js';
import { discoverPlayersForEvent, discoverSlateEvents, discoverUpcomingNflSlate, getConsensusSlatePrices, type DiscoveredPlayer } from '../providers/slateDiscovery.js';
import { buildPlayerPropModel, espnObservation, snapToRealisticLine, isLineNearProjection, mlbObservation, minimumSampleFor, normalizeMarket, type HistoricalObservation, type ModelSport } from '../models/playerPropModel.js';
import { evaluatePropLine } from '../models/propLineEvaluation.js';
import { featureWindow, type PlayerFeatureProfile } from '../candidates/featureProfile.js';
import { recordCandidateEvaluations } from '../candidates/candidateHistory.js';
import { hasCurrentMarketLine } from '../lib/parlayQuality.js';
import { loadLearning } from '../lib/predictionStore.js';
import type { ToolDef, ToolOutcome } from './tools.js';

const ESPN_MAP: Record<Exclude<ModelSport, 'mlb'>, espn.EspnSport> = {
  nba: 'basketball/nba', nfl: 'football/nfl', nhl: 'hockey/nhl',
};

type CachedHistory = {
  source: string;
  season: Record<string, unknown>;
  /** Merged history used only for the model sample. */
  games: any[];
  /** Current-season rows drive displayed L5/L10/season form. */
  currentGames: any[];
  /** Prior-season rows are context only; they never masquerade as current form. */
  priorGames: any[] | null;
  usedPriorSeason: boolean;
  mode: 'mlb' | 'espn';
};

type RequestedSide = 'over' | 'under';

export const SPORT_MARKETS: Record<ModelSport, string[]> = {
  mlb: ['hits', 'totalBases', 'strikeouts', 'outsRecorded'],
  nba: ['points', 'rebounds', 'assists', 'threePointersMade', 'pointsReboundsAssists'],
  nfl: ['passingYards', 'passingTouchdowns', 'rushingYards', 'rushingAttempts', 'receivingYards', 'receptions', 'touchdowns'],
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
  // A game already underway is not a place to place a pre-game prop: its markets are
  // closed or moved. Exclude in-progress/halftime as well as terminal states.
  return !['final', 'completed', 'postponed', 'canceled', 'cancelled', 'in_progress', 'in progress', 'halftime', 'delayed', 'suspended', 'rained out'].some((token) => value.includes(token));
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
    markets = [...SPORT_MARKETS.nba];
  } else if (sport === 'nfl') {
    // Position-specific opportunity markets. Anytime TD is available to the
    // skill positions that actually score; passing markets only apply to QBs.
    if (pos === 'QB') markets = ['passingYards', 'passingTouchdowns', 'rushingYards', 'rushingAttempts'];
    else if (pos === 'RB' || pos === 'FB') markets = ['rushingYards', 'rushingAttempts', 'receptions', 'touchdowns'];
    else if (pos === 'WR' || pos === 'TE') markets = ['receivingYards', 'receptions', 'touchdowns'];
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
/**
 * Legacy prior-season fallback trigger kept for sports whose screening output
 * must not change. Only NBA's trigger had drifted below the model minimum
 * (5 vs 8); MLB uses its own statsapi path and NFL already requires 5.
 */
const PRESERVED_FALLBACK_MINIMUM = 5;

/** Current-season game count below which prior-season history is merged. */
export function priorSeasonFallbackThreshold(sport: ModelSport): number {
  return sport === 'nba' ? minimumSampleFor(sport) : PRESERVED_FALLBACK_MINIMUM;
}

/**
 * Whether a current-season log is short enough that prior-season data should
 * be merged. NBA needs 8 games, so 5-, 6- and 7-game logs trigger the fallback
 * instead of waiting for fewer than 5.
 */
export function needsPriorSeasonFallback(sport: ModelSport, currentSeasonGames: number): boolean {
  return currentSeasonGames < priorSeasonFallbackThreshold(sport);
}

/**
 * Merge current-season games with optional prior-season games: current-season
 * rows stay first, duplicate gameIds are dropped, and the combined history is
 * capped at 20 rows. Pure so the threshold regression is testable without IO.
 */
export function mergeSeasonGames(
  currentGames: any[],
  priorGames: any[] | null | undefined,
): { games: any[]; usedPriorSeason: boolean } {
  if (!Array.isArray(priorGames)) return { games: currentGames, usedPriorSeason: false };
  const seen = new Set(currentGames.map((game) => String(game?.gameId)));
  const games = [...currentGames, ...priorGames.filter((game) => !seen.has(String(game?.gameId)))].slice(0, 20);
  return { games, usedPriorSeason: games.length > currentGames.length };
}

/**
 * Season start year for a reference date. NBA/NHL seasons span two calendar
 * years and start in October; NFL starts in September. July is the safe split.
 */
export function currentSeasonStartYear(
  sport: ModelSport,
  reference: Date = new Date(),
): number {
  const year = reference.getUTCFullYear();
  const month = reference.getUTCMonth() + 1;
  if (sport === 'mlb') return year;
  return month >= 7 ? year : year - 1;
}

function seasonLabelMatchesStart(sport: ModelSport, label: string, startYear: number): boolean {
  const text = String(label ?? '').trim();
  // Legacy/unlabeled payroll fixtures and some endpoints omit the year. Only
  // reject a label when it explicitly names a different season.
  if (!/\b(?:19|20)\d{2}\b/.test(text)) return true;
  if (sport === 'nba' || sport === 'nhl') {
    const end = String(startYear + 1).slice(-2);
    return new RegExp(`(^|\\D)${startYear}-${end}(\\D|$)`).test(text);
  }
  return new RegExp(`(^|\\D)${startYear}(\\D|$)`).test(text);
}

/** True when a gamelog's season label is the current season for the reference date. */
export function seasonLabelMatches(sport: ModelSport, label: string, reference: Date = new Date()): boolean {
  return seasonLabelMatchesStart(sport, label, currentSeasonStartYear(sport, reference));
}

/**
 * ESPN's `season` query uses the season END year for NBA/NHL but the START year
 * for NFL. This helper returns the correct prior-season query value.
 */
export function priorSeasonParam(sport: ModelSport, reference: Date = new Date()): number {
  const start = currentSeasonStartYear(sport, reference);
  return sport === 'nba' || sport === 'nhl' ? start : start - 1;
}

async function loadPlayerHistory(
  player: DiscoveredPlayer,
  sport: ModelSport,
  referenceDate?: string | null,
): Promise<CachedHistory | null> {
  if (sport === 'mlb') {
    const found = await mlb.searchPlayer(player.name);
    if (!found.available || !found.data) return null;
    const pitching = player.probablePitcher || String(player.position ?? '').toUpperCase().includes('P');
    const log = await mlb.getGameLog(found.data.id, pitching ? 'pitching' : 'hitting', mlb.CURRENT_SEASON, 20);
    if (!log.available || !Array.isArray(log.data)) return null;
    return {
      source: 'statsapi.mlb.com', season: { playerId: found.data.id, season: mlb.CURRENT_SEASON },
      games: log.data, currentGames: log.data, priorGames: null, usedPriorSeason: false, mode: 'mlb',
    };
  }
  const s = sport as Exclude<ModelSport, 'mlb'>;
  let playerId = player.id != null ? String(player.id) : '';
  if (!playerId) {
    const found = await espn.findPlayer(player.name, ESPN_MAP[s]);
    if (!found.available || !found.player) return null;
    playerId = found.player.id;
  }
  const reference = new Date(`${referenceDate ?? player.eventDate ?? new Date().toISOString().slice(0, 10)}T12:00:00Z`);
  const log = await espn.getGamelog(playerId, ESPN_MAP[s], 20);
  if (!log.available || !Array.isArray(log.games)) return null;
  // ESPN falls back to the player's most recent season when they have no games
  // in the current one. An explicitly different season label means these rows
  // are prior-season context, never current L5/L10 form.
  const labelIsCurrent = seasonLabelMatches(sport, String(log.season ?? ''), reference);
  const currentGames = labelIsCurrent ? log.games : [];
  let priorGames: any[] | null = labelIsCurrent ? null : log.games;
  let games = currentGames;
  let usedPriorSeason = false;
  if (needsPriorSeasonFallback(sport, currentGames.length)) {
    if (!priorGames?.length) {
      const prior = await espn.getGamelog(playerId, ESPN_MAP[s], 20, priorSeasonParam(sport, reference));
      if (prior.available && Array.isArray(prior.games) && prior.games.length) {
        const priorStart = currentSeasonStartYear(sport, reference) - 1;
        priorGames = seasonLabelMatchesStart(sport, String(prior.season ?? ''), priorStart) ? prior.games : null;
      }
    }
    if (priorGames?.length) {
      ({ games, usedPriorSeason } = mergeSeasonGames(currentGames, priorGames));
    }
  }
  if (!currentGames.length && !priorGames?.length) return null;
  return {
    source: usedPriorSeason ? 'site.web.api.espn.com (current + prior season)' : 'site.web.api.espn.com',
    season: { season: log.season ?? null, currentSeasonLabel: labelIsCurrent ? log.season ?? null : null, priorSeasonFallback: usedPriorSeason },
    games, currentGames, priorGames, usedPriorSeason,
    mode: 'espn',
  };
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

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function averageOf(values: Array<number | null | undefined>): number | null {
  const finite = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (!finite.length) return null;
  return finite.reduce((sum, value) => sum + value, 0) / finite.length;
}

/** ESPN gamelogs publish minutes as "34:12" or "34"; never guess a missing value. */
export function minutesFromStats(stats: Record<string, any>): number | null {
  const raw = stats?.minutes ?? stats?.min ?? stats?.MIN;
  if (raw == null || raw === '') return null;
  const text = String(raw).trim();
  const clock = /^(\d{1,3}):(\d{2})$/.exec(text);
  if (clock) return Number(clock[1]) + Number(clock[2]) / 60;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

export interface ResearchGameRow {
  value: number;
  minutes: number | null;
  /** Opportunities used for form: minutes (NBA) or attempts+targets (NFL). */
  usage: number | null;
  date: string | null;
  opponent: string | null;
}

function finiteStat(stats: Record<string, any>, ...keys: string[]): number | null {
  for (const key of keys) {
    const raw = stats?.[key];
    if (raw == null || raw === '') continue;
    const value = Number(String(raw).replace(/,/g, ''));
    if (Number.isFinite(value)) return value;
  }
  return null;
}

/**
 * Usage/opportunity proxy. NBA exposes minutes; NFL exposes passing attempts,
 * rushing attempts or receiving targets depending on the market. Missing
 * values stay null rather than becoming a fabricated zero.
 */
export function usageFromStats(sport: ModelSport, market: string, stats: Record<string, any>): number | null {
  if (sport === 'nba') return minutesFromStats(stats);
  if (sport !== 'nfl') return null;
  const normalized = normalizeMarket(market);
  if (normalized.startsWith('passing')) return finiteStat(stats, 'passingAttempts');
  if (normalized === 'receivingYards' || normalized === 'receptions' || normalized === 'receivingTargets') {
    return finiteStat(stats, 'receivingTargets', 'targets');
  }
  // Rushing markets and anytime TD: total opportunities (carries + targets).
  const carries = finiteStat(stats, 'rushingAttempts', 'carries');
  const targets = finiteStat(stats, 'receivingTargets', 'targets');
  if (carries == null && targets == null) return null;
  return (carries ?? 0) + (targets ?? 0);
}

/** Per-game values used for research form. Ordered as the source log (newest first). */
export function researchGameRows(
  history: CachedHistory,
  sport: ModelSport,
  market: string,
  games: any[] = history.currentGames ?? history.games,
): ResearchGameRow[] {
  const rows: ResearchGameRow[] = [];
  for (const game of games) {
    const value = history.mode === 'mlb'
      ? mlbObservation(market, game.stat ?? {})
      : espnObservation(sport as Exclude<ModelSport, 'mlb'>, market, game.stats ?? {});
    if (value == null || !Number.isFinite(value)) continue;
    const minutes = history.mode === 'espn' ? minutesFromStats(game.stats ?? {}) : null;
    // A zero-minute NBA row is a DNP, not a played game. Keep null (unpublished)
    // minutes because some providers omit the field rather than reporting zero.
    if (sport === 'nba' && minutes != null && minutes <= 0) continue;
    const rawOpponent = game.opponent ?? game.opponentName ?? null;
    const opponent = typeof rawOpponent === 'string'
      ? rawOpponent
      : rawOpponent?.displayName ?? null;
    rows.push({
      value,
      minutes,
      usage: history.mode === 'espn' ? usageFromStats(sport, market, game.stats ?? {}) : null,
      date: game.date ?? game.gameDate ?? null,
      opponent: opponent != null ? String(opponent) : null,
    });
  }
  return rows;
}

export interface ResearchFormInput {
  /** Stat values ordered most-recent first. Current season only. */
  values: number[];
  minutes?: Array<number | null>;
  usage?: Array<number | null>;
  opponents?: Array<string | null>;
  opponentName?: string | null;
  threshold: number;
  side: 'over' | 'under';
  dataDate?: string | null;
  priorValues?: number[];
  priorSeasonLabel?: string | null;
}

export interface ResearchForm {
  l5Average: number | null;
  l10Average: number | null;
  seasonAverage: number | null;
  seasonSampleSize: number;
  minutesL5: number | null;
  minutesL10: number | null;
  minutesSeason: number | null;
  usageL5: number | null;
  usageL10: number | null;
  usageSeason: number | null;
  projection: number | null;
  projectionLow: number | null;
  projectionHigh: number | null;
  trend: number | null;
  consistencyStdDev: number | null;
  consistencyLabel: 'high' | 'medium' | 'low' | null;
  hitFrequency: number | null;
  wins: number;
  losses: number;
  pushes: number;
  dataDate: string | null;
  opponentSampleSize: number;
  opponentAverage: number | null;
  priorSeasonAverage: number | null;
  priorSeasonSampleSize: number;
  priorSeasonLabel: string | null;
}

/**
 * Pure research-only form summary. Values are ordered most-recent first.
 * L5/L10 capture recency, seasonAverage/seasonSampleSize expose the larger
 * sample, and the projection is a transparent weighted blend. None of these
 * are sportsbook lines, odds, implied probabilities or EV.
 */
export function buildResearchForm(input: ResearchFormInput): ResearchForm {
  const values = input.values.filter((value) => Number.isFinite(value) && value >= 0);
  const minutes = Array.isArray(input.minutes) ? input.minutes : [];
  const usage = Array.isArray(input.usage) ? input.usage : [];
  const opponents = Array.isArray(input.opponents) ? input.opponents : [];
  const priorValues = (Array.isArray(input.priorValues) ? input.priorValues : [])
    .filter((value) => Number.isFinite(value) && value >= 0);
  const l5 = averageOf(values.slice(0, 5));
  const l10 = averageOf(values.slice(0, 10));
  const season = averageOf(values);

  const blends: Array<{ value: number; weight: number }> = [];
  if (l5 != null) blends.push({ value: l5, weight: 0.5 });
  if (l10 != null) blends.push({ value: l10, weight: 0.3 });
  if (season != null) blends.push({ value: season, weight: 0.2 });
  const weightTotal = blends.reduce((sum, row) => sum + row.weight, 0);
  const projection = weightTotal
    ? round1(blends.reduce((sum, row) => sum + row.value * row.weight, 0) / weightTotal)
    : null;

  const last10 = values.slice(0, 10);
  let consistencyStdDev: number | null = null;
  let consistencyLabel: ResearchForm['consistencyLabel'] = null;
  if (last10.length >= 3) {
    const mean = last10.reduce((sum, value) => sum + value, 0) / last10.length;
    const variance = last10.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (last10.length - 1);
    const stdDev = Math.sqrt(variance);
    consistencyStdDev = round1(stdDev);
    const coefficient = mean > 0 ? stdDev / mean : null;
    consistencyLabel = coefficient == null ? null : coefficient <= 0.25 ? 'high' : coefficient <= 0.5 ? 'medium' : 'low';
  }

  const wins = values.filter((value) => input.side === 'over' ? value > input.threshold : value < input.threshold).length;
  const pushes = values.filter((value) => value === input.threshold).length;
  const losses = values.length - wins - pushes;
  const decisions = wins + losses;

  const targetOpponent = normalizeName(String(input.opponentName ?? ''));
  const opponentValues = targetOpponent
    ? values.filter((_, index) => {
        const opponent = normalizeName(String(opponents[index] ?? ''));
        return opponent.length > 0 && (opponent === targetOpponent || opponent.includes(targetOpponent) || targetOpponent.includes(opponent));
      })
    : [];
  const priorAverage = averageOf(priorValues);

  return {
    l5Average: l5 == null ? null : round1(l5),
    l10Average: l10 == null ? null : round1(l10),
    seasonAverage: season == null ? null : round1(season),
    seasonSampleSize: values.length,
    minutesL5: averageOf(minutes.slice(0, 5)),
    minutesL10: averageOf(minutes.slice(0, 10)),
    minutesSeason: averageOf(minutes),
    usageL5: averageOf(usage.slice(0, 5)),
    usageL10: averageOf(usage.slice(0, 10)),
    usageSeason: averageOf(usage),
    projection,
    projectionLow: projection == null || consistencyStdDev == null ? null : round1(projection - consistencyStdDev),
    projectionHigh: projection == null || consistencyStdDev == null ? null : round1(projection + consistencyStdDev),
    trend: l5 == null || l10 == null ? null : round1(l5 - l10),
    consistencyStdDev,
    consistencyLabel,
    hitFrequency: decisions ? wins / decisions : null,
    wins,
    losses,
    pushes,
    dataDate: input.dataDate ?? null,
    opponentSampleSize: opponentValues.length,
    opponentAverage: opponentValues.length
      ? round1(opponentValues.reduce((sum, value) => sum + value, 0) / opponentValues.length)
      : null,
    priorSeasonAverage: priorAverage == null ? null : round1(priorAverage),
    priorSeasonSampleSize: priorValues.length,
    priorSeasonLabel: input.priorSeasonLabel ?? null,
  };
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

interface InjuryInfo {
  designation: string;
  excluded: boolean;
}

function classifyInjuryStatus(status: string): InjuryInfo {
  const value = String(status ?? '').toLowerCase();
  const excluded = /out|injured reserve|\bir\b|suspend|inactive|disabled|not active/.test(value);
  const designation = excluded ? 'out/inactive' : /doubt/.test(value) ? 'doubtful' : 'questionable';
  return { designation, excluded };
}

/**
 * One cached league injury read. Confirmed out/inactive players are removed
 * from research; questionable/doubtful players remain research-eligible with an
 * explicit caveat. A failed or unavailable injury feed never blocks the slate —
 * it simply leaves the caveat unset.
 */
async function loadInjuryIndex(sport: ModelSport): Promise<Map<string, InjuryInfo>> {
  const index = new Map<string, InjuryInfo>();
  if (sport === 'mlb') return index;
  const result = await espn.getLeagueInjuries(ESPN_MAP[sport as Exclude<ModelSport, 'mlb'>]).catch(() => null);
  if (!result?.available) return index;
  for (const injury of result.injuries) {
    const key = normalizeName(injury.playerName);
    if (!key) continue;
    index.set(key, classifyInjuryStatus(injury.status));
  }
  return index;
}

const handler = async (args: any): Promise<ToolOutcome> => {
  const sport = String(args?.sport ?? 'mlb').toLowerCase() as ModelSport;
  if (!['mlb', 'nba', 'nfl', 'nhl'].includes(sport)) return unavailable(`unsupported sport ${sport}`);
  let date = requestedDate(args?.date);
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
  const sameGame = args?.sameGame === true;
  // Pull a wider pool for market/side-specific requests. Filtering to one market
  // or one direction naturally removes many generic top candidates, so screen
  // enough distinct athletes to have a fair chance of satisfying 5-6 pick asks.
  // The system prompt requires roughly 4-5N players; the old 2N cap made that
  // instruction impossible to obey and is the main cause of short pick lists.
  const defaultPlayers = sameGame
    ? Math.max(20, requested * 5)
    : constrained ? Math.max(20, requested * 5) : Math.max(24, requested * 5);
  const maxPlayersCap = sameGame ? 36 : 40;
  const maxPlayers = Math.min(maxPlayersCap, Math.max(8, Number(args?.maxPlayers ?? defaultPlayers) || defaultPlayers));
  const minConfidence = Math.max(0.5, Math.min(0.75, Number(args?.minConfidence ?? 0.54) || 0.54));
  const excludeNames = new Set<string>(
    Array.isArray(args?.exclude)
      ? args.exclude.map((n: any) => String(n ?? '').toLowerCase()).filter(Boolean)
      : String(args?.exclude ?? '').split(',').map((s: string) => s.trim().toLowerCase()).filter(Boolean),
  );

  const discovery = sport === 'nfl' && (args?.searchUpcoming ?? !args?.date)
    ? discoverUpcomingNflSlate(date) : discoverSlateEvents(sport, date);
  const events = (await discovery.catch((e) => {
    console.warn(`[slateScreener] slate discovery failed for ${sport} ${date}: ${(e as Error).message}`);
    return [] as Awaited<ReturnType<typeof discoverSlateEvents>>;
  })).filter((event) => usableEvent(event.status));
  if (!events.length) {
    const reason = `no upcoming ${sport.toUpperCase()} events found for ${date}`;
    console.warn(`[slateScreener] ${reason}`);
    return unavailable(reason);
  }
  date = events[0].date;
  console.log(`[slateScreener] ${sport} ${date}: ${events.length} scheduled events found`);
  // Bound slate scope while sampling across the entire day instead of only the
  // first games. This keeps the same timeout discipline without systematically
  // ignoring later games that may contain stronger requested-market candidates.
  // An SGP must draw every leg from one event. Scope discovery before player
  // balancing so a five-leg SGP is not diluted to one or two players per game.
  const defaultMaxEvents = sameGame ? 1 : constrained ? 8 : 6;
  const maxEvents = Math.min(Number(args?.maxEvents ?? defaultMaxEvents) || defaultMaxEvents, events.length);
  const scopedEvents = spreadEvents(events, maxEvents);
  const groups = await mapConcurrent(scopedEvents, 4, async (event) =>
    (await discoverPlayersForEvent(event, excludeNames).catch((e) => {
      console.warn(`[slateScreener] player discovery failed for event ${event.eventId}: ${(e as Error).message}`);
      return [] as DiscoveredPlayer[];
    })) as DiscoveredPlayer[]
  );
  const players = balanced(groups, maxPlayers);
  if (!players.length) {
    const reason = `no roster candidates discovered for ${sport.toUpperCase()} slate${excludeNames.size ? ' after excluding prior picks' : ''}`;
    console.warn(`[slateScreener] ${reason}`);
    return unavailable(reason);
  }
  console.log(`[slateScreener] screening ${players.length} players across ${scopedEvents.length} events (concurrency 6)`);

  const learning = await loadLearning().catch(() => null);
  const injuryIndex = await loadInjuryIndex(sport);
  const minimumSample = minimumSampleFor(sport);
  const evaluated: any[] = [];
  // Funnel accounting: a shortfall must name the exact gate that removed
  // candidates instead of a generic "evidence floor" message. Counts are
  // player-market pairs so they add up to the considered total.
  const gates = {
    playerMarketsConsidered: 0,
    noGameHistory: 0,
    insufficientSample: 0,
    insufficientCurrentSample: 0,
    modelUnavailable: 0,
    belowConfidence: 0,
    duplicatePlayer: 0,
    injuryExcluded: 0,
  };
  await mapConcurrent(players, 6, async (player) => {
    const markets = marketsFor(player, sport, marketFilter);
    gates.playerMarketsConsidered += markets.length;
    const injury = injuryIndex.get(normalizeName(player.name)) ?? null;
    if (injury?.excluded) {
      gates.injuryExcluded += markets.length;
      return;
    }
    const history = await loadPlayerHistory(player, sport, player.eventDate).catch(() => null);
    if (!history) {
      gates.noGameHistory += markets.length;
      return;
    }
    for (const market of markets) {
      // Model sample may include the disclosed prior-season fallback. Displayed
      // L5/L10 form is always current-season only.
      const gameRows = researchGameRows(history, sport, market);
      const modelRows = researchGameRows(history, sport, market, history.games);
      const rows: HistoricalObservation[] = modelRows.map((row) => ({ date: row.date, value: row.value }));
      if (rows.length < minimumSample) {
        gates.insufficientSample += 1;
        continue;
      }
      // A prior-season-only model would not be current form. Require at least a
      // small current-season sample before any research pick can be shown.
      if (gameRows.length < 3) {
        gates.insufficientCurrentSample += 1;
        continue;
      }
      const values = rows.map((row) => row.value);
      // Snap to the nearest bookable line (same contract as universal screener).
      const line = snapToRealisticLine(sport, market, halfLine(rows));
      // Without a real market line, a snapped line far from the player's own
      // projection invents an easy side (2.1 RPG -> "under 3.5"). Skip it; the
      // no-odds path must stay honest about what the ladder can support.
      const projection = rows.reduce((sum, row) => sum + row.value, 0) / rows.length;
      if (!isLineNearProjection(projection, line)) continue;
      const calibration = calibrationFor(learning, sport, normalizeMarket(market));
      const sides: RequestedSide[] = sideFilter ? [sideFilter] : ['over', 'under'];
      const models = sides
        .map((side) => buildPlayerPropModel({ sport, market, side, line, observations: rows, source: history.source, calibration }))
        .filter((x) => x.available && x.probability != null)
        .sort((a, b) => (b.probability ?? 0) - (a.probability ?? 0));
      const model = models[0];
      if (!model?.available || model.probability == null || !model.grade) {
        gates.modelUnavailable += 1;
        continue;
      }
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
      evaluated.push({ player, market: normalizeMarket(market), line, model, profile, source: history.source, observations: rows, gameRows, calibration, injury, history });
    }
  });

  const filterLabel = [marketFilter, sideFilter?.toUpperCase()].filter(Boolean).join(' ');
  if (!evaluated.length) {
    const reason = `no supported ${sport.toUpperCase()} ${filterLabel || 'markets'} had enough recent-game history`;
    console.warn(`[slateScreener] ${reason} (0 of ${players.length} players produced >=${minimumSample} observations)`);
    return unavailable(reason);
  }
  console.log(`[slateScreener] evaluated ${evaluated.length} player-markets; ${evaluated.filter(({ model }) => model.grade !== 'D' && (model.probability ?? 0) >= minConfidence).length} above ${Math.round(minConfidence * 100)}% before dedupe`);
  await recordCandidateEvaluations(evaluated.map(({ player, market, line, model, profile, source }) => ({
    eventDate: player.eventDate, eventId: player.eventId, sport, player: player.name, team: player.team, opponent: player.opponent,
    market, side: model.side, line, modelProbability: model.probability, grade: model.grade, sampleSize: model.sampleSize,
    modelVersion: model.modelVersion, modelSource: source, sources: profile.sources, fallbackUsed: sport !== 'mlb',
    metadata: { lineupSlot: player.lineupSlot, availability: profile.availability },
  }))).catch(() => {});

  const qualified = evaluated
    .filter(({ model }) => model.grade !== 'D' && (model.probability ?? 0) >= minConfidence)
    .sort((a, b) => (b.model.probability ?? 0) - (a.model.probability ?? 0) || b.model.sampleSize - a.model.sampleSize);
  gates.belowConfidence = evaluated.length - qualified.length;

  // Screen OUT the players the final availability gate would reject anyway.
  // One cached league-injury read prevents the model from spending its six
  // requested slots on Questionable/Day-To-Day names (verified 2026-11-09:
  // a 6-leg NBA request failed at 5/6 because the model picked a Day-To-Day
  // player the screener had already ranked first).
  const injuryByName = new Map<string, string>();
  try {
    const report = await espn.getLeagueInjuries(ESPN_MAP[sport as Exclude<ModelSport, 'mlb'>] ?? 'basketball/nba');
    if (report.available) {
      for (const injury of report.injuries) {
        if (isBlockingInjuryStatus(injury.status)) {
          injuryByName.set(normalizeName(injury.playerName), String(injury.status ?? 'injured'));
        }
      }
    }
  } catch { /* the final gate still fails closed; screening proceeds */ }
  const healthyQualified = qualified.filter(({ player }) => !injuryByName.has(normalizeName(player.name)));

  const inLineup = (player: DiscoveredPlayer) => player.lineupSlot != null || player.probablePitcher;

  const lineupPosted = evaluated.some(({ player }) => inLineup(player));

  // Attach real sportsbook line/odds to candidates when the
  // player+market appears in the live props feed. The model's `line` is only a
  // derived proposal; when SharpApi has a real market for the same player+market
  // we surface the actual price. Never fabricated — only set on a real match.
  let sharpTimer: ReturnType<typeof setTimeout> | undefined;
  const sharpDeadline = new Promise<{ available: boolean; reason?: string; byKey: Map<string, any>; alternatesByKey: Map<string, any[]> }>((resolve) => {
    sharpTimer = setTimeout(() => resolve({ available: false, reason: 'live price lookup timed out (15s deadline)', byKey: new Map<string, any>(), alternatesByKey: new Map<string, any[]>() }), 15_000);
  });
  const sharpPrices = await Promise.race([
    getConsensusSlatePrices(sport),
    sharpDeadline,
  ]).catch(() => ({ available: false, reason: 'live price lookup crashed', byKey: new Map<string, any>(), alternatesByKey: new Map<string, any[]>() }));
  if (sharpTimer) clearTimeout(sharpTimer);
  if (!sharpPrices.available) {
    console.warn(`[slateScreener] live market prices unavailable (${sharpPrices.reason ?? 'unknown'}) — candidates carry model-derived lines only`);
  }
  const sharpByKey = sharpPrices.byKey;
  const alternatesByKey = sharpPrices.alternatesByKey;
  const sharpline = (player: string, market: string) => {
    const match = sharpByKey.get(`${player.toLowerCase()}|${normalizeMarket(market).toLowerCase()}`);
    return match ?? null;
  };

  // A player's highest model score may be on an unposted market. Choose the
  // best offered market first, then keep one leg per player. Unpriced rows
  // remain useful research but must never displace a verified offer.
  qualified.sort((a, b) =>
    Number(Boolean(sharpline(b.player.name, b.market))) - Number(Boolean(sharpline(a.player.name, a.market)))
    || Number(inLineup(b.player)) - Number(inLineup(a.player))
    || (b.model.probability ?? 0) - (a.model.probability ?? 0)
  );
  const seenPlayer = new Set<string>();
  const deduped = healthyQualified.filter(({ player }) => {
    const key = `${player.name}|${player.team}`.toLowerCase();
    if (seenPlayer.has(key)) return false;
    seenPlayer.add(key);
    return true;
  });
  gates.duplicatePlayer = qualified.length - deduped.length;

  const candidates = deduped.slice(0, Math.max(12, requested * 2)).flatMap(({ player, market, line, model, profile, observations, gameRows, calibration, injury, history }) => {
    const live = sharpline(player.name, market);
    const liveLine = live != null && Number.isFinite(Number(live.line)) ? Number(live.line) : null;
    const liveEvaluation = liveLine == null ? null : evaluatePropLine({
      sport, market, line: liveLine, observations, source: profile.sources?.[0] ?? 'unknown',
      calibration, requestedSide: sideFilter, oddsOver: live?.over ?? null, oddsUnder: live?.under ?? null,
    });
    const finalModel = (liveEvaluation?.chosen ?? model)!;
    // Re-apply the quality gate AFTER re-scoring at the live line. A candidate
    // that qualified at the screening line can fall to a D grade or below the
    // confidence floor at the book's actual number; showing it anyway would
    // recommend a leg the screen itself rejects.
    if (!finalModel?.available || finalModel.probability == null || !finalModel.grade
      || finalModel.grade === 'D' || finalModel.probability < minConfidence) return [];
    const finalLine = liveLine ?? line;
    const recentValues = observations.map((row: HistoricalObservation) => row.value);
    const hitRateAtLine = (windowSize: number): number | null | undefined => {
      const window = featureWindow(recentValues, finalLine, windowSize);
      return sideHitRate(window?.hitRateOverSuggestedLine, finalModel.side);
    };
    const recentAtDisplayedLine = {
      last5: hitRateAtLine(5),
      last10: hitRateAtLine(10),
      last20: hitRateAtLine(20),
    };
    // Current-season rows drive displayed L5/L10/season form. Prior-season rows
    // are context only and are never concatenated into the form values.
    const formRows: ResearchGameRow[] = Array.isArray(gameRows) ? gameRows : [];
    const priorRows: ResearchGameRow[] = history?.priorGames?.length
      ? researchGameRows(history, sport, market, history.priorGames)
      : [];
    const reference = player.eventDate ? new Date(`${player.eventDate}T12:00:00Z`) : new Date();
    const priorSeasonLabel = priorRows.length
      ? String(currentSeasonStartYear(sport, reference) - 1)
      : null;
    // If a real market line exists it is the research threshold even when the
    // modeled edge does not justify a verified pick. Otherwise the threshold is
    // the model's own sample-derived screening line, rounded to a conventional
    // half-point for interpretability. It is never presented as a quoted book.
    const thresholdBase = liveLine ?? line;
    const makeResearchForm = (side: 'over' | 'under') => buildResearchForm({
      values: formRows.map((row) => row.value),
      minutes: formRows.map((row) => row.minutes),
      usage: formRows.map((row) => row.usage),
      opponents: formRows.map((row) => row.opponent),
      opponentName: player.opponent,
      threshold: thresholdBase,
      side,
      dataDate: formRows[0]?.date ? String(formRows[0].date).slice(0, 10) : null,
      priorValues: priorRows.map((row) => row.value),
      priorSeasonLabel,
    });
    // The model (or the exact-line re-score when a real line exists) selected
    // this side at the displayed threshold, so direction and hit frequency stay
    // coherent even for research-only rows with an unpriced or unvalued offer.
    const formSide: 'over' | 'under' = liveLine != null ? finalModel.side : model.side;
    const baseForm = makeResearchForm(formSide);
    const sideOdds = finalModel.side === 'under' ? (live?.under ?? null) : (live?.over ?? null);
    const verified = liveLine != null
      && sideOdds != null
      && finalModel.grade !== 'D'
      && finalModel.estimatedEdge != null
      && finalModel.estimatedEdge > 0
      && hasCurrentMarketLine({
        entity_type: 'player', sport, market, side: finalModel.side, line: liveLine,
        odds: sideOdds, line_source: live?.source, line_checked_at: live?.checkedAt,
      });
    const researchOnly = (sport === 'nba' || sport === 'nfl') && !verified;
    const displayedSide: 'over' | 'under' = researchOnly ? formSide : finalModel.side;
    const researchForm = displayedSide === formSide ? baseForm : makeResearchForm(displayedSide);
    const researchGap = researchForm.projection == null ? null : round1(researchForm.projection - thresholdBase);
    // Express the gap in the direction of the recommended side. A projection
    // above the threshold is supportive of an OVER and contradictory for an
    // UNDER, so the rationale must never imply support the side does not have.
    const directionalGap = researchGap == null ? null : (displayedSide === 'under' ? -researchGap : researchGap);
    const trendLabel = researchForm.trend == null
      ? null
      : Math.abs(researchForm.trend) < 0.5
        ? 'flat'
        : researchForm.trend > 0 ? 'rising' : 'falling';
    const researchRationale = [
      researchGap == null
        ? null
        : `Projection ${researchGap >= 0 ? '+' : ''}${researchGap} vs research threshold (${directionalGap! >= 0 ? 'supports' : 'against'} the ${displayedSide.toUpperCase()})`,
      researchForm.hitFrequency == null
        ? null
        : `${Math.round(researchForm.hitFrequency * 100)}% empirical hit rate across ${researchForm.wins + researchForm.losses} current-season decisions`,
      researchForm.consistencyLabel == null ? null : `${researchForm.consistencyLabel} recent consistency`,
      trendLabel ? `${trendLabel} L5-vs-L10 trend` : null,
      researchForm.opponentSampleSize
        ? `${researchForm.opponentSampleSize} game${researchForm.opponentSampleSize === 1 ? '' : 's'} vs this opponent in the sample`
        : 'opponent-specific game history unavailable',
    ].filter(Boolean).join('; ');
    const recentGames = formRows.slice(0, 5).map((row) => ({
      date: row.date ? String(row.date).slice(0, 10) : null,
      opponent: row.opponent,
      value: round1(row.value),
      usage: row.usage == null ? null : round1(row.usage),
    }));
    // A live sportsbook line is authoritative: both sides are re-scored at
    // that line, and positive value gets priority over the raw-probability
    // under bias that appears when the screening line is higher than the book.
    return [{
      sport, modelVersion: finalModel.modelVersion, source: profile.sources?.[0] ?? 'unknown',
      player: player.name, team: player.team, opponent: player.opponent, eventId: player.eventId, eventDate: player.eventDate,
      gameDate: player.eventDate,
      homeAway: player.homeAway,
      matchupContext: `${player.homeAway === 'home' ? 'vs' : '@'} ${player.opponent}`,
      market, side: displayedSide, suggestedLine: line, modelLine: line,
      screeningSide: model.side, confidencePct: Math.round((finalModel.probability ?? 0) * 1000) / 10,
      grade: finalModel.grade, sampleSize: finalModel.sampleSize,
      projection: researchOnly ? researchForm.projection : finalModel.average ?? null,
      recommendationType: verified ? 'verified' : researchOnly ? 'research' : 'unverified',
      researchOnly,
      direction: displayedSide,
      historicalThreshold: researchOnly ? thresholdBase : null,
      historicalThresholdSource: researchOnly
        ? (liveLine != null ? 'current market line (edge not verified)' : 'sample-derived model benchmark rounded to a conventional half-point (not a sportsbook line)')
        : null,
      marketProbability: researchOnly || liveLine == null ? null : finalModel.probability ?? null,
      marketLine: researchOnly ? null : (live?.line ?? null),
      marketOddsOver: researchOnly ? null : (live?.over ?? null),
      marketOddsUnder: researchOnly ? null : (live?.under ?? null),
      marketSource: researchOnly ? null : (live?.source ?? null),
      marketCheckedAt: researchOnly ? null : (live?.checkedAt ?? null),
      marketBook: researchOnly ? null : (live?.book ?? null),
      bookCount: researchOnly ? null : (live?.bookCount ?? null),
      lineType: researchOnly ? null : (live?.lineType ?? null),
      isAlternate: researchOnly ? false : (live?.isAlternate ?? false),
      lineLabel: researchOnly ? null : (live?.lineLabel ?? null),
      alternateLines: researchOnly ? [] : (alternatesByKey.get(`${player.name.toLowerCase()}|${normalizeMarket(market).toLowerCase()}`) ?? []),
      estimatedEdge: researchOnly ? null : (liveEvaluation?.chosen?.estimatedEdge == null ? null : Math.round(liveEvaluation.chosen.estimatedEdge * 1000) / 10),
      edgeOver: researchOnly ? null : (liveEvaluation?.edgeOver == null ? null : Math.round(liveEvaluation.edgeOver * 1000) / 10),
      edgeUnder: researchOnly ? null : (liveEvaluation?.edgeUnder == null ? null : Math.round(liveEvaluation.edgeUnder * 1000) / 10),
      edgeLine: researchOnly ? null : liveLine,
      availability: profile.availability,
      availabilityNote: injury
        ? `${injury.designation === 'out/inactive' ? 'Out/inactive' : injury.designation} on the current ESPN injury report — verify before acting`
        : null,
      inLineupToday: inLineup(player),
      lineupSlot: player.lineupSlot,
      recentHitRate: recentAtDisplayedLine,
      l5Average: researchForm.l5Average,
      l10Average: researchForm.l10Average,
      seasonAverage: researchForm.seasonAverage,
      seasonSampleSize: researchForm.seasonSampleSize,
      currentSampleSize: researchForm.seasonSampleSize,
      minutesL5: researchForm.minutesL5,
      minutesL10: researchForm.minutesL10,
      minutesSeason: researchForm.minutesSeason,
      usageL5: researchForm.usageL5,
      usageL10: researchForm.usageL10,
      usageSeason: researchForm.usageSeason,
      trend: researchForm.trend,
      trendLabel,
      projectionLow: researchForm.projectionLow,
      projectionHigh: researchForm.projectionHigh,
      consistencyStdDev: researchForm.consistencyStdDev,
      consistencyLabel: researchForm.consistencyLabel,
      hitFrequency: researchForm.hitFrequency,
      historicalWins: researchForm.wins,
      historicalLosses: researchForm.losses,
      historicalPushes: researchForm.pushes,
      dataDate: researchForm.dataDate,
      recentGames,
      opponentSampleSize: researchForm.opponentSampleSize,
      opponentAverage: researchForm.opponentAverage,
      opponentDefenseAvailable: false,
      priorSeasonAverage: researchForm.priorSeasonAverage,
      priorSeasonSampleSize: researchForm.priorSeasonSampleSize,
      priorSeasonLabel: researchForm.priorSeasonLabel,
      usedPriorSeason: Boolean(history?.usedPriorSeason),
      rationale: researchOnly ? researchRationale : undefined,
      note: researchOnly
        ? 'Research-only: no verified sportsbook line/price with positive modeled edge; the research threshold is not a bettable recommendation.'
        : liveLine == null
          ? 'Model screening line only; no verified sportsbook offer was found.'
          : 'Both sides re-scored at the exact current sportsbook line; verify final availability before treating as a recommendation.',
    }];
  });
  // Rank verified-price candidates first (either side has a real edge — matches the
  // "verified lines" requirement), then by chosen-side edge, then confidence.
  candidates.sort((a: any, b: any) => {
    const aPriced = (a.edgeOver != null || a.edgeUnder != null) ? 0 : 1;
    const bPriced = (b.edgeOver != null || b.edgeUnder != null) ? 0 : 1;
    return aPriced - bPriced
      || (b.estimatedEdge ?? -Infinity) - (a.estimatedEdge ?? -Infinity)
      || (b.confidencePct ?? 0) - (a.confidencePct ?? 0);
  });

  const payload: any = {
    available: true,
    sport,
    date,
    requestFilters: { market: marketFilter, side: sideFilter },
    slate: {
      events: events.length, screenedEvents: scopedEvents.length, discoveredPlayers: players.length,
      modelEvaluations: evaluated.length, qualifiedCandidates: deduped.length, lineupPosted,
      minimumSample, insufficientSamples: gates.insufficientSample,
      priceProviderAvailable: sharpPrices.available,
      priceProviderReason: sharpPrices.available ? undefined : (sharpPrices.reason ?? 'unavailable'),
      gates,
      verifiedCandidates: candidates.filter((candidate) => candidate.recommendationType === 'verified').length,
      researchCandidates: candidates.filter((candidate) => candidate.researchOnly === true).length,
    },
    candidates,
    providerPolicy: { apiSportsRequired: false, fallbackRule: 'MLB uses MLB Stats API; NBA/NFL/NHL use ESPN recent game logs.' },
  };
  if (!lineupPosted) {
    payload.warning = sport === 'mlb'
      ? 'Batting orders have NOT been posted for this date yet. Candidates below come from current rosters/probable pitchers and are NOT confirmable starters. Re-run closer to game time once lineups post.'
      : 'Starting lineups have NOT been posted for this date yet. Candidates below come from current rosters and are NOT confirmable starters. Re-run closer to game time once lineups post.';
  }
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
      searchUpcoming: { type: 'boolean', description: 'For undated NFL requests, find the next upcoming slate within 7 days. False for an explicitly requested day.' },
      requestedPicks: { type: 'number', description: 'How many picks the user asked for' },
      market: { type: 'string', description: 'Optional exact requested prop market. Preserve the user request; e.g. total bases -> totalBases, hits -> hits, strikeouts -> strikeouts.' },
      side: { type: 'string', enum: ['over', 'under'], description: 'Optional requested direction. If the user asks for OVER bets, pass over; if UNDER, pass under. Never omit an explicit user direction.' },
      exclude: { type: 'array', items: { type: 'string' }, description: 'Optional player names to exclude, especially for more/other/different follow-ups.' },
      maxPlayers: { type: 'number', description: '8-22 players; constrained market/side requests automatically screen a wider pool' },
      maxEvents: { type: 'number', description: 'Screen at most this many events (forced to one for same-game parlays)' },
      sameGame: { type: 'boolean', description: 'True for Same Game Parlay/SGP requests; scopes every candidate to one event' },
      minConfidence: { type: 'number', description: 'Decimal; default 0.54' },
    },
    required: ['sport'],
  },
  handler,
};
