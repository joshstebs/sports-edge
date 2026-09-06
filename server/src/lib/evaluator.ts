import {
  getAllPredictions, getPendingPredictions, saveLearning, updatePrediction,
  type LegOutcome, type LearningContext, type Prediction, type PredictionLeg,
} from './predictionStore.js';
import { settleLedgerMatches } from '../routes/ledger.js';
import * as espn from '../providers/espn.js';
import { espnObservation, normalizeMarket, type ModelSport } from '../models/playerPropModel.js';

const MLB_BASE = 'https://statsapi.mlb.com/api/v1';
const DEFAULT_MAX_PREDICTIONS = 20;
const DEFAULT_MAX_LEGS = 50;
const DEFAULT_BUDGET_MS = 45_000;
const MAX_ATTEMPTS = 5;
const EXPIRY_DAYS = 4;

type Market = string;

export interface EvaluationRunResult {
  startedAt: string;
  finishedAt: string;
  processed: number;
  evaluated: number;
  needsReview: number;
  deferred: number;
  ledgerSettled: number;
  remainingPending: number;
  learning: LearningContext;
  details: Array<{ predictionId: string; status: string; note?: string }>;
}

export interface EvaluationOptions {
  maxPredictions?: number;
  maxLegs?: number;
  timeBudgetMs?: number;
  now?: Date;
  fetchImpl?: typeof fetch;
}

function round(value: number, places = 1): number {
  return Math.round(value * 10 ** places) / 10 ** places;
}
function norm(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}
function dateOnly(value: Date): string { return value.toISOString().slice(0, 10); }
function ageDays(date: string, now: Date): number {
  return Math.floor((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${dateOnly(now)}T12:00:00Z`)) / -86_400_000);
}

export function inferMarket(leg: PredictionLeg): Market {
  const explicitRaw = String(leg.market ?? '').trim();
  const explicit = norm(explicitRaw).replace(/ /g, '');
  const text = `${leg.leg_name ?? ''} ${leg.key_metric_used ?? ''}`.toLowerCase();
  if (explicit) {
    const aliases: Record<string, Market> = {
      strikeouts: 'strikeouts', pitcherstrikeouts: 'strikeouts', totalbases: 'totalBases',
      homeruns: 'homeRuns', homerun: 'homeRuns', rbi: 'rbi', hits: 'hits', runs: 'runs',
      walks: 'walks', stolenbases: 'stolenBases', hitsrunsrbi: 'hitsRunsRbi',
      earnedruns: 'earnedRuns', hitsallowed: 'hitsAllowed', walksallowed: 'walksAllowed',
      outsrecorded: 'outsRecorded', moneyline: 'moneyline', teamtotal: 'teamTotal',
    };
    if (aliases[explicit]) return aliases[explicit];
    const crossSport = normalizeMarket(explicitRaw);
    if (crossSport !== explicitRaw || /^[a-z][A-Za-z]+$/.test(crossSport)) return crossSport;
  }
  if (/hits?\s*\+\s*runs?\s*\+\s*rbis?|hrr/.test(text)) return 'hitsRunsRbi';
  if (/earned runs?/.test(text)) return 'earnedRuns';
  if (/hits? allowed/.test(text)) return 'hitsAllowed';
  if (/walks? allowed/.test(text)) return 'walksAllowed';
  if (/outs? recorded/.test(text)) return 'outsRecorded';
  if (/moneyline|\bml\b/.test(text)) return 'moneyline';
  if (/team total|team runs/.test(text)) return 'teamTotal';
  if (/strikeout|k's|\bks?\b/.test(text)) return 'strikeouts';
  if (/total bases?/.test(text)) return 'totalBases';
  if (/home runs?|\bhr\b/.test(text)) return 'homeRuns';
  if (/\brbis?\b/.test(text)) return 'rbi';
  if (/stolen bases?/.test(text)) return 'stolenBases';
  if (/\bwalks?\b/.test(text)) return 'walks';
  if (/\bruns?\b/.test(text)) return 'runs';
  if (/\bhits?\b/.test(text)) return 'hits';
  if (/passing yards?/.test(text)) return 'passingYards';
  if (/rushing yards?/.test(text)) return 'rushingYards';
  if (/receiving yards?/.test(text)) return 'receivingYards';
  if (/\breceptions?\b/.test(text)) return 'receptions';
  if (/\bpoints?\b/.test(text)) return 'points';
  if (/\brebounds?\b/.test(text)) return 'rebounds';
  if (/\bassists?\b/.test(text)) return 'assists';
  if (/shots? on goal/.test(text)) return 'shotsOnGoal';
  if (/\bsaves?\b/.test(text)) return 'saves';
  return 'unknown';
}

export function parseLineAndSide(leg: PredictionLeg): { line: number | null; side: 'over' | 'under' } {
  if (Number.isFinite(leg.line) && leg.side) return { line: Number(leg.line), side: leg.side };
  const combined = `${leg.leg_name ?? ''} ${leg.target_line ?? ''}`;
  const match = /(over|under|o|u)\s*([0-9]+(?:\.[0-9]+)?)/i.exec(combined);
  const fallback = Number(String(leg.target_line ?? '').replace(/[^0-9.\-]/g, ''));
  const line = match ? Number(match[2]) : Number.isFinite(fallback) ? fallback : null;
  const side = (match?.[1]?.toLowerCase().startsWith('u') || /\bunder\b/i.test(combined)) ? 'under' : 'over';
  return { line, side };
}

function grade(actual: number, line: number, side: 'over' | 'under'): Exclude<LegOutcome, 'ungraded'> {
  if (actual === line) return 'push';
  return (actual > line) === (side === 'over') ? 'won' : 'lost';
}

function teamNames(game: any): Array<{ side: 'away' | 'home'; text: string }> {
  return (['away', 'home'] as const).map((side) => ({
    side, text: norm(`${game?.teams?.[side]?.team?.name ?? ''} ${game?.teams?.[side]?.team?.clubName ?? ''} ${game?.teams?.[side]?.team?.abbreviation ?? ''}`),
  }));
}

function matchupParts(matchup: string): string[] {
  return matchup.split(/\s+(?:vs\.?|versus|@|at)\s+/i).map(norm).filter(Boolean);
}

function teamMatches(candidate: string, official: string): boolean {
  if (!candidate || !official) return false;
  if (official.includes(candidate) || candidate.includes(official)) return true;
  const meaningful = candidate.split(' ').filter((token) => token.length >= 4 && !['team'].includes(token));
  return meaningful.length > 0 && meaningful.every((token) => official.includes(token));
}

export function gameMatchesMatchup(game: any, matchup: string): boolean {
  const parts = matchupParts(matchup);
  if (parts.length !== 2) return false;
  const names = teamNames(game);
  return (teamMatches(parts[0], names[0].text) && teamMatches(parts[1], names[1].text)) ||
    (teamMatches(parts[0], names[1].text) && teamMatches(parts[1], names[0].text));
}

function extractPlayerName(leg: PredictionLeg): string {
  return (leg.leg_name ?? '')
    .replace(/\b(over|under|o|u)\s*[0-9]+(?:\.[0-9]+)?/gi, '')
    .replace(/\b(total bases?|hits?\s*\+\s*runs?\s*\+\s*rbis?|points?\s*\+\s*rebounds?\s*\+\s*assists?|rushing\s*\+\s*receiving yards?|hits? allowed|walks? allowed|earned runs?|outs? recorded|passing yards?|passing touchdowns?|rushing yards?|receiving yards?|receptions?|points?|rebounds?|assists?|three pointers? made|shots? on goal|blocked shots?|saves?|goals? against|hits?|home runs?|rbis?|runs?|walks?|stolen bases?|strikeouts?|ks?)\b/gi, '')
    .replace(/[.,():-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function boxPlayers(box: any): any[] {
  return (['away', 'home'] as const).flatMap((side) => Object.values(box?.teams?.[side]?.players ?? {}));
}

function findPlayer(leg: PredictionLeg, box: any): any | null {
  const players = boxPlayers(box);
  if (leg.player_id != null) {
    const byId = players.find((player: any) => String(player?.person?.id) === String(leg.player_id));
    if (byId) return byId;
  }
  const wanted = norm(extractPlayerName(leg));
  if (!wanted) return null;
  const exact = players.find((player: any) => norm(player?.person?.fullName ?? '') === wanted);
  if (exact) return exact;
  const surname = wanted.split(' ').at(-1);
  const candidates = players.filter((player: any) => norm(player?.person?.fullName ?? '').split(' ').at(-1) === surname);
  return candidates.length === 1 ? candidates[0] : null;
}

function numericStat(player: any, group: 'batting' | 'pitching', key: string): number {
  const value = Number(player?.stats?.[group]?.[key]);
  return Number.isFinite(value) ? value : 0;
}
function playerActual(player: any, market: Market): number | null {
  const bat = (key: string) => numericStat(player, 'batting', key);
  const pitch = (key: string) => numericStat(player, 'pitching', key);
  switch (market) {
    case 'strikeouts': return pitch('strikeOuts');
    case 'totalBases': return player?.stats?.batting?.totalBases != null
      ? bat('totalBases') : bat('hits') + bat('doubles') + 2 * bat('triples') + 3 * bat('homeRuns');
    case 'homeRuns': return bat('homeRuns');
    case 'rbi': return bat('rbi');
    case 'hits': return bat('hits');
    case 'runs': return bat('runs');
    case 'walks': return bat('baseOnBalls');
    case 'stolenBases': return bat('stolenBases');
    case 'hitsRunsRbi': return bat('hits') + bat('runs') + bat('rbi');
    case 'earnedRuns': return pitch('earnedRuns');
    case 'hitsAllowed': return pitch('hits');
    case 'walksAllowed': return pitch('baseOnBalls');
    case 'outsRecorded': {
      const innings = String(player?.stats?.pitching?.inningsPitched ?? '0');
      const [whole, partial = '0'] = innings.split('.');
      return Number(whole) * 3 + Math.min(2, Number(partial));
    }
    default: return null;
  }
}

function findNamedTeam(game: any, text: string): 'away' | 'home' | null {
  const cleaned = norm(text.replace(/moneyline|\bml\b|team total|team runs|over|under|[0-9.]+/gi, ' '));
  const matches = teamNames(game).filter((team) => teamMatches(cleaned, team.text) || teamMatches(team.text, cleaned));
  return matches.length === 1 ? matches[0].side : null;
}

function runsFor(game: any, side: 'away' | 'home'): number | null {
  const value = game?.teams?.[side]?.score;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

export function evaluateLeg(leg: PredictionLeg, box: any, game: any): { outcome: LegOutcome; actual: number | null; note?: string } {
  const market = inferMarket(leg);
  if (market === 'unknown') return { outcome: 'ungraded', actual: null, note: 'unsupported or ambiguous market' };
  if (market === 'moneyline') {
    const side = findNamedTeam(game, leg.leg_name);
    if (!side) return { outcome: 'ungraded', actual: null, note: 'moneyline team could not be identified' };
    const away = runsFor(game, 'away'); const home = runsFor(game, 'home');
    if (away == null || home == null || away === home) return { outcome: 'ungraded', actual: null, note: 'final score unavailable' };
    const won = side === 'away' ? away > home : home > away;
    return { outcome: won ? 'won' : 'lost', actual: won ? 1 : 0 };
  }
  const { line, side } = parseLineAndSide(leg);
  if (line == null) return { outcome: 'ungraded', actual: null, note: 'line or side could not be parsed' };
  if (market === 'teamTotal') {
    const teamSide = findNamedTeam(game, leg.leg_name);
    const actual = teamSide ? runsFor(game, teamSide) : null;
    return actual == null ? { outcome: 'ungraded', actual: null, note: 'team total team could not be identified' }
      : { outcome: grade(actual, line, side), actual };
  }
  const player = findPlayer(leg, box);
  // A player absent from a final box score did not participate; player props are normally void.
  if (!player) return { outcome: 'push', actual: null, note: 'player did not appear in final box score (void/DNP)' };
  const actual = playerActual(player, market);
  return actual == null ? { outcome: 'ungraded', actual: null, note: `market ${market} is not gradeable` }
    : { outcome: grade(actual, line, side), actual };
}

function predictionDate(prediction: Prediction): string | null {
  if (prediction.gameDate && /^\d{4}-\d{2}-\d{2}$/.test(prediction.gameDate)) return prediction.gameDate;
  const legacy = prediction.timestamp?.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(legacy) ? legacy : null;
}

function parseProbability(value: unknown): number | null {
  const number = Number(String(value ?? '').replace('%', '').trim());
  if (!Number.isFinite(number)) return null;
  const probability = number > 1 ? number / 100 : number;
  return probability >= 0 && probability <= 1 ? probability : null;
}
function parseAmericanOdds(value: unknown): number | null {
  const normalized = String(value ?? '').replace(/−/g, '-').match(/[+-]?\d+/)?.[0];
  const number = normalized == null ? NaN : Number(normalized);
  return Number.isFinite(number) && number !== 0 ? number : null;
}

const ESPN_SPORTS: Record<'NFL' | 'NBA' | 'NHL', espn.EspnSport> = {
  NFL: 'football/nfl', NBA: 'basketball/nba', NHL: 'hockey/nhl',
};

async function evaluateEspnLeg(
  leg: PredictionLeg,
  sport: 'NFL' | 'NBA' | 'NHL',
  gameDate: string,
  eventId?: string | number | null,
  matchup?: string | null,
): Promise<{ outcome: LegOutcome; actual: number | null; note?: string }> {
  const market = inferMarket(leg);

  if (market === 'moneyline') {
    const parts = matchupParts(String(matchup ?? ''));
    const result = await espn.getEventResult(
      ESPN_SPORTS[sport],
      gameDate,
      eventId,
      parts[0] ?? null,
      parts[1] ?? null,
    );
    if (!result.available || !result.result) {
      return { outcome: 'ungraded', actual: null, note: `official ${sport} game result unavailable for ${gameDate}: ${result.reason ?? 'unknown reason'}` };
    }
    if (!result.result.completed) {
      return { outcome: 'ungraded', actual: null, note: `official ${sport} game is not final yet (${result.result.status || 'in progress'}); will retry` };
    }
    const awayScore = result.result.away.score;
    const homeScore = result.result.home.score;
    if (awayScore == null || homeScore == null) {
      return { outcome: 'ungraded', actual: null, note: 'official final score is unavailable; will retry' };
    }
    const selection = norm(String(leg.leg_name ?? ''));
    const awaySelected = teamMatches(selection, norm(result.result.away.name));
    const homeSelected = teamMatches(selection, norm(result.result.home.name));
    if (awaySelected === homeSelected) {
      return { outcome: 'ungraded', actual: null, note: 'moneyline team could not be identified unambiguously' };
    }
    if (awayScore === homeScore) return { outcome: 'push', actual: 0.5, note: 'game ended tied; two-way moneyline treated as push' };
    const selectedWon = awaySelected ? awayScore > homeScore : homeScore > awayScore;
    return { outcome: selectedWon ? 'won' : 'lost', actual: selectedWon ? 1 : 0 };
  }

  const { line, side } = parseLineAndSide(leg);
  if (market === 'unknown' || line == null) return { outcome: 'ungraded', actual: null, note: 'structured market, side and line are required' };
  let playerId = leg.player_id != null ? String(leg.player_id) : '';
  if (!playerId) {
    const name = extractPlayerName(leg);
    if (!name) return { outcome: 'ungraded', actual: null, note: 'official player_id or an unambiguous player name is required' };
    const found = await espn.findPlayer(name, ESPN_SPORTS[sport]);
    if (!found.available || !found.player) return { outcome: 'ungraded', actual: null, note: found.reason ?? 'player not found on current roster' };
    playerId = found.player.id;
  }
  const log = await espn.getGamelog(playerId, ESPN_SPORTS[sport], 20);
  if (!log.available || !Array.isArray(log.games)) throw new Error(log.reason ?? 'official ESPN gamelog unavailable');
  const wantedEvent = eventId == null ? null : String(eventId);
  const game = log.games.find((entry) => wantedEvent ? entry.gameId === wantedEvent : entry.gameDate.slice(0, 10) === gameDate);
  if (!game) {
    return { outcome: 'ungraded', actual: null, note: `no official ${sport} player gamelog entry found for ${gameDate}; DNP/void cannot be assumed` };
  }
  return evaluateEspnLegFromStats(leg, sport, game.stats);
}

export function evaluateEspnLegFromStats(
  leg: PredictionLeg, sport: 'NFL' | 'NBA' | 'NHL', stats: Record<string, any>,
): { outcome: LegOutcome; actual: number | null; note?: string } {
  const market = inferMarket(leg);
  const { line, side } = parseLineAndSide(leg);
  if (market === 'unknown' || line == null) return { outcome: 'ungraded', actual: null, note: 'structured market, side and line are required' };
  const actual = espnObservation(sport.toLowerCase() as Exclude<ModelSport, 'mlb'>, market, stats);
  return actual == null
    ? { outcome: 'ungraded', actual: null, note: `official gamelog does not expose supported market ${market}` }
    : { outcome: grade(actual, line, side), actual };
}

export function buildLearningContext(predictions: Prediction[], now = new Date()): LearningContext {
  const settledRows = predictions.flatMap((prediction) => prediction.legs.map((leg) => ({ leg, sport: prediction.sport.toUpperCase() })))
    .filter((row) => row.leg.outcome === 'won' || row.leg.outcome === 'lost' || row.leg.outcome === 'push');
  const settledLegs = settledRows.map((row) => row.leg);
  const binary = settledLegs.filter((leg) => leg.outcome === 'won' || leg.outcome === 'lost');
  const won = binary.filter((leg) => leg.outcome === 'won').length;
  const lost = binary.length - won;
  const pushes = settledLegs.filter((leg) => leg.outcome === 'push').length;
  let net = 0; let priced = 0;
  for (const leg of binary) {
    const odds = parseAmericanOdds(leg.implied_odds);
    if (odds == null) continue;
    priced++;
    net += leg.outcome === 'won' ? (odds > 0 ? odds / 100 : 100 / -odds) : -1;
  }
  const calibrated = binary.map((leg) => ({ leg, p: parseProbability(leg.model_probability), y: leg.outcome === 'won' ? 1 : 0 }))
    .filter((row): row is { leg: PredictionLeg; p: number; y: number } => row.p != null);
  const brierScore = calibrated.length ? round(calibrated.reduce((sum, row) => sum + (row.p - row.y) ** 2, 0) / calibrated.length, 3) : null;
  const grouped = new Map<Market, typeof calibrated>();
  for (const row of calibrated) grouped.set(inferMarket(row.leg), [...(grouped.get(inferMarket(row.leg)) ?? []), row]);
  // Include markets without probabilities in hit-rate reporting.
  const allGrouped = new Map<Market, PredictionLeg[]>();
  for (const leg of binary) allGrouped.set(inferMarket(leg), [...(allGrouped.get(inferMarket(leg)) ?? []), leg]);
  const perMarket: LearningContext['perMarket'] = {};
  const perSportMarket: NonNullable<LearningContext['perSportMarket']> = {};
  const adaptiveRules: string[] = [];
  for (const [market, legs] of [...allGrouped.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const hits = legs.filter((leg) => leg.outcome === 'won').length;
    const rows = grouped.get(market) ?? [];
    const averageP = rows.length ? rows.reduce((sum, row) => sum + row.p, 0) / rows.length : null;
    const actual = legs.length ? hits / legs.length : 0;
    const shrunkActual = (hits + 5) / (legs.length + 10); // Beta(5,5), resists noisy small samples.
    perMarket[market] = {
      n: legs.length, hitRate: round(actual * 100),
      averageConfidence: averageP == null ? null : round(averageP * 100),
      calibrationError: averageP == null ? null : round((averageP - actual) * 100),
      brierScore: rows.length ? round(rows.reduce((sum, row) => sum + (row.p - row.y) ** 2, 0) / rows.length, 3) : null,
    };
    // Never alter confidence from a tiny sample. At n>=20 use shrinkage and only
    // correct material overconfidence; historical wins alone do not prove an edge.
    if (legs.length >= 20 && averageP != null && averageP - shrunkActual >= 0.08) {
      adaptiveRules.push(`Recalibrate ${market} downward: stated probability averaged ${round(averageP * 100)}% versus shrinkage-adjusted outcomes ${round(shrunkActual * 100)}% over ${legs.length} picks.`);
    }
    if (legs.length >= 20 && averageP != null && shrunkActual - averageP >= 0.08) {
      adaptiveRules.push(`Review ${market} for underconfidence: stated probability averaged ${round(averageP * 100)}% versus shrinkage-adjusted outcomes ${round(shrunkActual * 100)}% over ${legs.length} picks; do not raise it without current-market evidence.`);
    }
  }
  const sportGroups = new Map<string, Array<{ leg: PredictionLeg; p: number | null; y: number }>>();
  for (const row of settledRows) {
    if (row.leg.outcome !== 'won' && row.leg.outcome !== 'lost') continue;
    // Sport-specific calibration feeds empirical-beta-v1 back into itself; do
    // not mix legacy LLM confidences or another model version into that signal.
    if (row.leg.model_version !== 'empirical-beta-v1') continue;
    const key = `${row.sport}:${inferMarket(row.leg)}`;
    const item = { leg: row.leg, p: parseProbability(row.leg.model_probability), y: row.leg.outcome === 'won' ? 1 : 0 };
    sportGroups.set(key, [...(sportGroups.get(key) ?? []), item]);
  }
  for (const [key, rows] of [...sportGroups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const hits = rows.filter((row) => row.y === 1).length;
    const calibratedRows = rows.filter((row): row is { leg: PredictionLeg; p: number; y: number } => row.p != null);
    const averageP = calibratedRows.length ? calibratedRows.reduce((sum, row) => sum + row.p, 0) / calibratedRows.length : null;
    const actual = hits / rows.length;
    const shrunkActual = (hits + 5) / (rows.length + 10);
    perSportMarket[key] = {
      n: rows.length, hitRate: round(actual * 100),
      averageConfidence: averageP == null ? null : round(averageP * 100),
      calibrationError: averageP == null ? null : round((averageP - actual) * 100),
      brierScore: calibratedRows.length
        ? round(calibratedRows.reduce((sum, row) => sum + (row.p - row.y) ** 2, 0) / calibratedRows.length, 3) : null,
    };
    if (rows.length >= 20 && averageP != null && averageP - shrunkActual >= 0.08) {
      adaptiveRules.push(`Recalibrate ${key} downward: stated ${round(averageP * 100)}% versus shrinkage-adjusted outcomes ${round(shrunkActual * 100)}% over ${rows.length} verified picks.`);
    }
  }
  if (priced >= 20 && net / priced < -0.1) adaptiveRules.push('Use 0.5u maximum sizing while verified-odds ROI remains below -10%; do not chase losses.');
  return {
    updatedAt: now.toISOString(), evaluated: binary.length, won, lost, pushes, priced,
    hitRate: binary.length ? round(won / binary.length * 100) : null,
    roi: priced ? round(net / priced * 100) : null, brierScore, perMarket, perSportMarket, adaptiveRules,
  };
}

export async function runPredictionEvaluation(options: EvaluationOptions = {}): Promise<EvaluationRunResult> {
  const now = options.now ?? new Date();
  const startedAt = new Date().toISOString();
  const deadline = Date.now() + (options.timeBudgetMs ?? DEFAULT_BUDGET_MS);
  const maxPredictions = options.maxPredictions ?? DEFAULT_MAX_PREDICTIONS;
  const maxLegs = options.maxLegs ?? DEFAULT_MAX_LEGS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const scheduleCache = new Map<string, any[]>();
  let fetchTail = Promise.resolve();
  const pacedFetch = async (url: string): Promise<any> => {
    const previous = fetchTail;
    let release!: () => void;
    fetchTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(Math.min(8_000, Math.max(1_000, deadline - Date.now()))) });
      if (!response.ok) throw new Error(`MLB Stats API HTTP ${response.status}`);
      return response.json();
    } finally { release(); }
  };
  const getSchedule = async (date: string): Promise<any[]> => {
    if (scheduleCache.has(date)) return scheduleCache.get(date)!;
    const data = await pacedFetch(`${MLB_BASE}/schedule?sportId=1&date=${date}&hydrate=team`);
    const games = (data?.dates ?? []).flatMap((day: any) => day.games ?? []);
    scheduleCache.set(date, games);
    return games;
  };

  const pending = (await getPendingPredictions()).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const details: EvaluationRunResult['details'] = [];
  let processed = 0; let evaluated = 0; let needsReview = 0; let deferred = 0; let legsUsed = 0; let ledgerSettled = 0;

  for (const prediction of pending) {
    if (processed >= maxPredictions || legsUsed + prediction.legs.length > maxLegs || Date.now() >= deadline) { deferred++; continue; }
    processed++; legsUsed += prediction.legs.length;
    const attemptAt = new Date().toISOString();
    const attempts = (prediction.evaluationAttempts ?? 0) + 1;
    const gameDate = predictionDate(prediction);
    if (!gameDate) {
      const note = 'No valid game date; add game_date (YYYY-MM-DD)';
      const legs = prediction.legs.map((leg) => ({ ...leg, outcome: 'ungraded' as const, evaluation_note: note, evaluated_at: attemptAt }));
      await updatePrediction(prediction.prediction_id, { status: 'needs_review', evaluationNote: note, evaluationAttempts: attempts, lastEvaluationAttemptAt: attemptAt, legs });
      needsReview++; details.push({ predictionId: prediction.prediction_id, status: 'needs_review', note });
      continue;
    }
    if (ageDays(gameDate, now) < 0) { deferred++; details.push({ predictionId: prediction.prediction_id, status: 'pending', note: `game is scheduled for ${gameDate}` }); continue; }
    if (prediction.sport !== 'MLB' && !['NFL', 'NBA', 'NHL'].includes(prediction.sport)) {
      const note = `${prediction.sport} auto-grading is unsupported; excluded from learning`;
      const legs = prediction.legs.map((leg) => ({ ...leg, outcome: 'ungraded' as const, evaluation_note: note, evaluated_at: attemptAt }));
      await updatePrediction(prediction.prediction_id, { status: 'needs_review', evaluationNote: note, evaluationAttempts: attempts, lastEvaluationAttemptAt: attemptAt, legs });
      needsReview++; details.push({ predictionId: prediction.prediction_id, status: 'needs_review', note });
      continue;
    }
    if (prediction.sport === 'NFL' || prediction.sport === 'NBA' || prediction.sport === 'NHL') {
      try {
        const evaluatedAt = new Date().toISOString();
        const legs = [] as PredictionLeg[];
        for (const leg of prediction.legs) {
          const result = await evaluateEspnLeg(leg, prediction.sport, gameDate, prediction.event_id, prediction.matchup);
          legs.push({ ...leg, outcome: result.outcome, actual: result.actual, evaluation_note: result.note ?? null, evaluated_at: evaluatedAt });
        }
        const graded = legs.filter((leg) => leg.outcome === 'won' || leg.outcome === 'lost' || leg.outcome === 'push');
        const hasUngraded = legs.some((leg) => leg.outcome === 'ungraded');
        const ungraded = legs.filter((leg) => leg.outcome === 'ungraded');
        const retryableMissing = ungraded.length > 0 && ungraded.every((leg) =>
          /no official .* gamelog entry|game result unavailable|game is not final yet|final score is unavailable/i.test(leg.evaluation_note ?? '')
        );
        const expired = ageDays(gameDate, now) >= EXPIRY_DAYS && attempts >= MAX_ATTEMPTS;
        const status = retryableMissing && !expired ? 'pending' : hasUngraded ? 'needs_review' : 'evaluated';
        const note = retryableMissing && !expired
          ? `Official ${prediction.sport} gamelog is not posted for ${gameDate}; will retry`
          : hasUngraded ? 'One or more structured markets could not be verified and were excluded from learning' : null;
        await updatePrediction(prediction.prediction_id, {
          status, evaluationNote: note, evaluatedAt: status === 'pending' ? null : evaluatedAt, gameDate,
          evaluationAttempts: attempts, lastEvaluationAttemptAt: attemptAt, legs,
        });
        for (const leg of graded) {
          try { ledgerSettled += await settleLedgerMatches(prediction.matchup, leg.leg_name, leg.outcome as 'won' | 'lost' | 'push', evaluatedAt, prediction.userId ?? 'admin'); }
          catch (error) { console.error('Ledger auto-settlement failed:', error); }
        }
        if (status === 'evaluated') evaluated++;
        else if (status === 'needs_review') needsReview++;
        else deferred++;
        details.push({ predictionId: prediction.prediction_id, status, note: note ?? undefined });
      } catch (error) {
        const expired = ageDays(gameDate, now) >= EXPIRY_DAYS && attempts >= MAX_ATTEMPTS;
        const note = `${prediction.sport} evaluation provider error: ${(error as Error).message}`;
        const legs = expired ? prediction.legs.map((leg) => ({ ...leg, outcome: 'ungraded' as const, evaluation_note: note, evaluated_at: attemptAt })) : prediction.legs;
        await updatePrediction(prediction.prediction_id, { status: expired ? 'needs_review' : 'pending', evaluationNote: note, evaluationAttempts: attempts, lastEvaluationAttemptAt: attemptAt, legs });
        if (expired) needsReview++; else deferred++;
        details.push({ predictionId: prediction.prediction_id, status: expired ? 'needs_review' : 'pending', note });
      }
      continue;
    }
    try {
      const games = await getSchedule(gameDate);
      const explicitId = prediction.gamePk ?? (Number.isInteger(Number(prediction.event_id)) ? Number(prediction.event_id) : null);
      const game = explicitId ? games.find((candidate) => Number(candidate.gamePk) === explicitId) : games.find((candidate) => gameMatchesMatchup(candidate, prediction.matchup));
      if (!game) {
        const expired = ageDays(gameDate, now) >= EXPIRY_DAYS && attempts >= MAX_ATTEMPTS;
        const note = `No unambiguous MLB game found for ${prediction.matchup} on ${gameDate}`;
        const legs = expired ? prediction.legs.map((leg) => ({ ...leg, outcome: 'ungraded' as const, evaluation_note: note, evaluated_at: attemptAt })) : prediction.legs;
        await updatePrediction(prediction.prediction_id, { status: expired ? 'needs_review' : 'pending', evaluationNote: note, gameDate, evaluationAttempts: attempts, lastEvaluationAttemptAt: attemptAt, legs });
        if (expired) needsReview++; else deferred++;
        details.push({ predictionId: prediction.prediction_id, status: expired ? 'needs_review' : 'pending', note });
        continue;
      }
      if (game?.status?.abstractGameState !== 'Final') {
        const note = `Game ${game.gamePk} is ${game?.status?.detailedState ?? 'not final'}; will retry`;
        await updatePrediction(prediction.prediction_id, { status: 'pending', evaluationNote: note, gameDate, gamePk: game.gamePk, evaluationAttempts: attempts, lastEvaluationAttemptAt: attemptAt });
        deferred++; details.push({ predictionId: prediction.prediction_id, status: 'pending', note });
        continue;
      }
      const box = await pacedFetch(`${MLB_BASE}/game/${game.gamePk}/boxscore`);
      const evaluatedAt = new Date().toISOString();
      const legs = prediction.legs.map((leg) => {
        const result = evaluateLeg(leg, box, game);
        return { ...leg, outcome: result.outcome, actual: result.actual, evaluation_note: result.note ?? null, evaluated_at: evaluatedAt };
      });
      const hasUngraded = legs.some((leg) => leg.outcome === 'ungraded');
      const status = hasUngraded ? 'needs_review' : 'evaluated';
      const note = hasUngraded ? 'One or more markets could not be graded and were excluded from learning' : null;
      await updatePrediction(prediction.prediction_id, {
        status, evaluationNote: note, evaluatedAt, gameDate, gamePk: game.gamePk,
        evaluationAttempts: attempts, lastEvaluationAttemptAt: attemptAt, legs,
      });
      for (const leg of legs) {
        if (leg.outcome === 'won' || leg.outcome === 'lost' || leg.outcome === 'push') {
          try { ledgerSettled += await settleLedgerMatches(prediction.matchup, leg.leg_name, leg.outcome, evaluatedAt, prediction.userId ?? 'admin'); }
          catch (error) { console.error('Ledger auto-settlement failed:', error); }
        }
      }
      if (status === 'evaluated') evaluated++; else needsReview++;
      details.push({ predictionId: prediction.prediction_id, status, note: note ?? undefined });
    } catch (error) {
      const expired = ageDays(gameDate, now) >= EXPIRY_DAYS && attempts >= MAX_ATTEMPTS;
      const note = `Evaluation provider error: ${(error as Error).message}`;
      const legs = expired ? prediction.legs.map((leg) => ({ ...leg, outcome: 'ungraded' as const, evaluation_note: note, evaluated_at: attemptAt })) : prediction.legs;
      await updatePrediction(prediction.prediction_id, { status: expired ? 'needs_review' : 'pending', evaluationNote: note, evaluationAttempts: attempts, lastEvaluationAttemptAt: attemptAt, legs });
      if (expired) needsReview++; else deferred++;
      details.push({ predictionId: prediction.prediction_id, status: expired ? 'needs_review' : 'pending', note });
    }
  }

  // Always rebuild from cumulative history. A cron batch can never erase older evidence.
  const learning = buildLearningContext(await getAllPredictions(), now);
  await saveLearning(learning);
  const remainingPending = (await getPendingPredictions()).length;
  return { startedAt, finishedAt: new Date().toISOString(), processed, evaluated, needsReview, deferred, ledgerSettled, remainingPending, learning, details };
}
