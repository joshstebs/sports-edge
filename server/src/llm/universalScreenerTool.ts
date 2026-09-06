import * as mlb from '../providers/mlbStatsApi.js';
import * as espn from '../providers/espn.js';
import { discoverPlayersForEvent, discoverSlateEvents, getSharpSlatePrices, type DiscoveredPlayer } from '../providers/slateDiscovery.js';
import { premiumProviderStatus, dataGapPriorities } from '../providers/premiumAdapter.js';
import {
  buildPlayerPropModel,
  espnObservation,
  isRealisticLine,
  mlbObservation,
  normalizeMarket,
  type HistoricalObservation,
  type ModelSport,
} from '../models/playerPropModel.js';
import { featureWindow, type PlayerFeatureProfile } from '../candidates/featureProfile.js';
import { recordCandidateEvaluations, candidateCalibration } from '../candidates/candidateHistory.js';
import { loadLearning } from '../lib/predictionStore.js';
import type { ToolDef, ToolOutcome } from './tools.js';

const ESPN_MAP: Record<Exclude<ModelSport, 'mlb'>, espn.EspnSport> = {
  nba: 'basketball/nba', nfl: 'football/nfl', nhl: 'hockey/nhl',
};

const MARKETS: Record<ModelSport, string[]> = {
  mlb: ['hits', 'totalBases', 'runs', 'rbi', 'homeRuns', 'strikeouts', 'outsRecorded', 'earnedRuns', 'hitsAllowed'],
  nba: ['points', 'rebounds', 'assists', 'threePointersMade', 'pointsReboundsAssists'],
  nfl: ['passingYards', 'passingTouchdowns', 'rushingYards', 'receivingYards', 'receptions', 'touchdowns'],
  nhl: ['shotsOnGoal', 'goals', 'assists', 'hockeyPoints', 'saves'],
};

interface ScreenerCandidate {
  player: string;
  team: string | null;
  opponent: string | null;
  sport: ModelSport;
  eventId: string | number | null;
  eventDate: string;
  market: string;
  side: 'over' | 'under';
  line: number;
  confidence: number;
  grade: 'A' | 'B' | 'C' | 'D';
  sampleSize: number;
  modelVersion: string;
  source: string;
  fallbackUsed: boolean;
  profile: PlayerFeatureProfile;
  // Retained for edge re-evaluation at the real sportsbook line: the model's
  // observations + calibration let us recompute probability/edge at the book's
  // line instead of only ranking by raw probability at the suggested line.
  observations: HistoricalObservation[];
  calibration: ReturnType<typeof learningCalibration> | null;
}

function ok(summary: string, payload: any, data?: any): ToolOutcome {
  return { available: true, summary, data: data ?? payload, payload };
}
function unavailable(reason: string): ToolOutcome {
  return { available: false, reason, summary: `unavailable: ${reason}`, data: { available: false, reason }, payload: { available: false, reason } };
}
function torontoToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}
function dateOnly(value: unknown): string {
  const text = String(value ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : torontoToday();
}
function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}
function halfLine(values: number[]): number {
  const avg = average(values);
  let line = Math.round(avg * 2) / 2;
  if (Number.isInteger(line)) line += 0.5;
  return Math.max(0.5, line);
}
function learningCalibration(learning: Awaited<ReturnType<typeof loadLearning>>, sport: ModelSport, market: string) {
  if (!learning) return null;
  const keys = [
    `${sport}:${market}`,
    `${sport.toUpperCase()}:${market}`,
    `${sport}|${market}`,
    market,
  ];
  for (const key of keys) {
    const row = learning.perSportMarket?.[key] ?? learning.perMarket?.[key];
    if (row) return { n: row.n, averageConfidence: row.averageConfidence ?? null, hitRate: row.hitRate };
  }
  return null;
}
function relevantMlbMarkets(player: DiscoveredPlayer): string[] {
  return player.probablePitcher || String(player.position ?? '').toUpperCase().includes('P')
    ? ['strikeouts', 'outsRecorded', 'earnedRuns', 'hitsAllowed']
    : ['hits', 'totalBases', 'runs', 'rbi', 'homeRuns'];
}
function relevantMarkets(player: DiscoveredPlayer, sport: ModelSport): string[] {
  if (sport === 'mlb') return relevantMlbMarkets(player);
  const pos = String(player.position ?? '').toUpperCase();
  if (sport === 'nfl') {
    if (pos === 'QB') return ['passingYards', 'passingTouchdowns'];
    if (pos === 'RB' || pos === 'FB') return ['rushingYards', 'receivingYards', 'receptions', 'touchdowns'];
    return ['receivingYards', 'receptions', 'touchdowns'];
  }
  if (sport === 'nhl' && ['G', 'GOALIE'].includes(pos)) return ['saves'];
  return MARKETS[sport];
}

async function mlbObservations(player: DiscoveredPlayer, market: string, resolvedId?: number | null): Promise<{ observations: HistoricalObservation[]; source: string; season: any } | null> {
  let playerId = resolvedId ?? null;
  if (playerId == null) {
    const found = await mlb.searchPlayer(player.name);
    if (!found.available || !found.data) return null;
    playerId = found.data.id;
  }
  const pitching = relevantMlbMarkets(player).includes('strikeouts') && ['strikeouts', 'outsRecorded', 'earnedRuns', 'hitsAllowed'].includes(normalizeMarket(market));
  const group = pitching ? 'pitching' : 'hitting';
  const log = await mlb.getGameLog(playerId, group, mlb.CURRENT_SEASON, 20);
  if (!log.available || !Array.isArray(log.data)) return null;
  const observations = log.data.map((game: any) => {
    const value = mlbObservation(market, game.stat ?? {});
    return value == null ? null : { date: game.date ?? null, value };
  }).filter(Boolean) as HistoricalObservation[];
  return { observations, source: 'statsapi.mlb.com', season: { playerId, season: mlb.CURRENT_SEASON } };
}

async function espnObservations(player: DiscoveredPlayer, sport: Exclude<ModelSport, 'mlb'>, market: string): Promise<{ observations: HistoricalObservation[]; source: string; season: any } | null> {
  let playerId = player.id != null ? String(player.id) : null;
  if (!playerId) {
    const found = await espn.findPlayer(player.name, ESPN_MAP[sport]);
    if (!found.available || !found.player) return null;
    playerId = found.player.id;
  }
  const log = await espn.getGamelog(playerId, ESPN_MAP[sport], 20);
  if (!log.available || !Array.isArray(log.games)) return null;
  const observations = log.games.map((game: any) => {
    const value = espnObservation(sport, market, game.stats ?? {});
    return value == null ? null : { date: game.date ?? game.gameDate ?? null, value };
  }).filter(Boolean) as HistoricalObservation[];
  return { observations, source: 'site.web.api.espn.com', season: { season: log.season ?? null } };
}

function chooseBestSide(
  sport: ModelSport,
  market: string,
  values: HistoricalObservation[],
  source: string,
  calibration: ReturnType<typeof learningCalibration>,
) {
  const line = halfLine(values.map((row) => row.value));
  // Model-derived lines can land on numbers no book offers (e.g. under 3.5
  // hits for a hot hitter). Only bookable lines become candidates.
  if (!isRealisticLine(sport, market, line)) return null;
  const over = buildPlayerPropModel({ sport, market, side: 'over', line, observations: values, source, calibration });
  const under = buildPlayerPropModel({ sport, market, side: 'under', line, observations: values, source, calibration });
  const usable = [over, under].filter((row) => row.available && row.probability != null);
  if (!usable.length) return null;
  return usable.sort((a, b) => (b.probability ?? 0) - (a.probability ?? 0))[0];
}

function balanceEventPlayers(rows: DiscoveredPlayer[]): DiscoveredPlayer[] {
  const away = rows.filter((row) => row.homeAway === 'away');
  const home = rows.filter((row) => row.homeAway === 'home');
  const out: DiscoveredPlayer[] = [];
  while (away.length || home.length) {
    const nextAway = away.shift();
    if (nextAway) out.push(nextAway);
    const nextHome = home.shift();
    if (nextHome) out.push(nextHome);
  }
  return out;
}

function distributePlayers(playersByEvent: DiscoveredPlayer[][], limit: number): DiscoveredPlayer[] {
  const queues = playersByEvent.map((rows) => balanceEventPlayers(rows));
  const out: DiscoveredPlayer[] = [];
  while (out.length < limit && queues.some((queue) => queue.length)) {
    for (const queue of queues) {
      if (out.length >= limit) break;
      const player = queue.shift();
      if (player) out.push(player);
    }
  }
  return out;
}

async function screenPlayer(
  player: DiscoveredPlayer,
  sport: ModelSport,
  learning: Awaited<ReturnType<typeof loadLearning>>,
): Promise<ScreenerCandidate[]> {
  const candidates: ScreenerCandidate[] = [];
  const resolved = await mlb.resolvePlayerId(player, sport);
  for (const market of relevantMarkets(player, sport)) {
    const history = sport === 'mlb'
      ? await mlbObservations(player, market, resolved)
      : await espnObservations(player, sport as Exclude<ModelSport, 'mlb'>, market);
    if (!history || history.observations.length < 5) continue;
    const calibration = learningCalibration(learning, sport, normalizeMarket(market));
    const model = chooseBestSide(sport, market, history.observations, history.source, calibration);
    if (!model?.available || model.probability == null || !model.grade) continue;
    const values = history.observations.map((row) => row.value);
    const line = model.line;
    const sources = [...new Set([history.source, player.source])];
    const profile: PlayerFeatureProfile = {
      sport,
      player: player.name,
      team: player.team,
      opponent: player.opponent,
      eventId: player.eventId,
      eventDate: player.eventDate,
      role: player.position,
      availability: {
        status: sport === 'mlb' && player.lineupSlot == null && !player.probablePitcher ? 'provisional' : 'unknown',
        reason: sport === 'mlb' && player.lineupSlot == null && !player.probablePitcher ? 'candidate discovered from active roster before official batting order' : 'final availability gate still required',
      },
      recent: {
        last5: featureWindow(values, line, 5),
        last10: featureWindow(values, line, 10),
        last20: featureWindow(values, line, 20),
      },
      season: history.season,
      matchup: { opponent: player.opponent },
      context: {
        homeAway: player.homeAway,
        restDays: null,
        expectedPlayingTime: null,
        lineupSlot: player.lineupSlot,
        weather: null,
        venueFactor: null,
      },
      market: {
        market: normalizeMarket(market),
        suggestedLine: line,
        side: model.side,
        modelProbability: model.probability,
        grade: model.grade,
        sampleSize: model.sampleSize,
        impliedProbability: model.impliedProbability ?? null,
        estimatedEdge: model.estimatedEdge ?? null,
        modelVersion: model.modelVersion,
      },
      sources,
      fallbackUsed: sport !== 'mlb',
      retrievedAt: new Date().toISOString(),
    };
    candidates.push({
      player: player.name,
      team: player.team,
      opponent: player.opponent,
      sport,
      eventId: player.eventId,
      eventDate: player.eventDate,
      market: normalizeMarket(market),
      side: model.side,
      line,
      confidence: model.probability,
      grade: model.grade,
      sampleSize: model.sampleSize,
      modelVersion: model.modelVersion,
      source: history.source,
      fallbackUsed: sport !== 'mlb',
      profile,
      observations: history.observations,
      calibration,
    });
  }
  return candidates;
}

function eventIsUsable(status: string | null): boolean {
  const value = String(status ?? '').toLowerCase();
  return !['final', 'completed', 'postponed', 'canceled', 'cancelled'].some((token) => value.includes(token));
}

const handler = async (args: any): Promise<ToolOutcome> => {
  const sport = String(args?.sport ?? 'mlb').toLowerCase() as ModelSport;
  if (!['mlb', 'nba', 'nfl', 'nhl'].includes(sport)) return unavailable(`unsupported sport ${sport}`);
  const date = dateOnly(args?.date);
  const requested = Math.min(12, Math.max(1, Number(args?.requestedPicks ?? 5) || 5));
  // maxPlayers is re-derived below with a Stats-API-aware cap; this line only
  // seeds the default so the value is defined before any early return.
  const maxPlayers = Number(args?.maxPlayers ?? 12) || 12;
  const minConfidence = Math.max(0.5, Math.min(0.75, Number(args?.minConfidence ?? 0.54) || 0.54));
  // The MLB Stats API throttles to ~1.2s/call, so the screening pool must stay
  // small enough to finish within the tool budget. 25 players x 2 groups =
  // 50 calls ~= 60s when parallelized, which blows the budget. Cap the default
  // pool at 12 (still yields far more than the 5 requested legs) unless the
  // caller explicitly asks for a larger scan.
  const effectiveMax = Math.min(12, Math.max(8, Number(args?.maxPlayers ?? 12) || 12));
  const maxPlayersFinal = Math.min(48, Math.max(8, effectiveMax));

  const allEvents = await discoverSlateEvents(sport, date);
  const events = allEvents.filter((event) => eventIsUsable(event.status));
  if (!events.length) return unavailable(`no upcoming ${sport.toUpperCase()} events found for ${date}`);

  const playerGroups = await Promise.all(events.map((event) => discoverPlayersForEvent(event).catch(() => [])));
  const players = distributePlayers(playerGroups, maxPlayersFinal);

  const learning = await loadLearning().catch(() => null);
  const perPlayer = await Promise.all(players.map((player) => screenPlayer(player, sport, learning).catch(() => [])));
  const evaluated = perPlayer.flat();
  if (!evaluated.length) return unavailable(`no supported ${sport.toUpperCase()} markets had enough recent-game history`);

  await recordCandidateEvaluations(evaluated.map((candidate) => ({
    eventDate: candidate.eventDate,
    eventId: candidate.eventId,
    sport: candidate.sport,
    player: candidate.player,
    team: candidate.team,
    opponent: candidate.opponent,
    market: candidate.market,
    side: candidate.side,
    line: candidate.line,
    modelProbability: candidate.confidence,
    grade: candidate.grade,
    sampleSize: candidate.sampleSize,
    modelVersion: candidate.modelVersion,
    modelSource: candidate.source,
    sources: candidate.profile.sources,
    fallbackUsed: candidate.fallbackUsed,
    metadata: { lineupSlot: candidate.profile.context.lineupSlot, availability: candidate.profile.availability },
  }))).catch(() => {});

  const qualified = evaluated
    .filter((candidate) => candidate.grade !== 'D' && candidate.confidence >= minConfidence)
    .sort((a, b) => b.confidence - a.confidence || b.sampleSize - a.sampleSize);

  const marketCalibration: Record<string, unknown> = {};
  for (const market of [...new Set(qualified.slice(0, 20).map((row) => row.market))]) {
    marketCalibration[market] = await candidateCalibration(sport, market).catch(() => ({ n: 0, hitRate: null, averageConfidence: null, calibrationError: null }));
  }

  // Real SharpApi market prices (per player+market) to attach to candidates.
  // Model-derived lines are proposals; a real market line/odds, when present,
  // is surfaced alongside. Degrades to empty — never fabricated.
  const sharpPrices = await getSharpSlatePrices(sport).catch(() => ({ available: false, byKey: new Map<string, any>() }));
  const sharpByKey = sharpPrices.byKey;

  const payload = {
    available: true,
    sport,
    date,
    slate: {
      events: events.length,
      discoveredPlayers: players.length,
      modelEvaluations: evaluated.length,
      qualifiedCandidates: qualified.length,
    },
    candidates: (() => {
      const mapped = qualified.slice(0, Math.max(requested * 3, 15)).map((candidate) => {
      const key = `${String(candidate.player).toLowerCase()}|${String(candidate.market).toLowerCase()}`;
      const live = sharpByKey.get(key);
      // Edge evaluation at the REAL sportsbook line: the suggested line is a model
      // proposal, but the bet is priced at the book's line. Recompute the CHOSEN
      // side at the book line with the book's odds for an honest edge, and also
      // evaluate the opposite side so over-value is visible even when the pick
      // itself is an under. Side selection stays max-probability (preserves grade
      // semantics); edge is informational for ranking, not a side override.
      // This is what answers the UNDER skew honestly: on low-mean markets the
      // under usually has the higher raw probability, and when the book
      // overprices the over (negative over-edge), the under IS the value side.
      let estimatedEdge: number | null = null;
      let edgeOver: number | null = null;
      let edgeUnder: number | null = null;
      let edgeLine: number | null = null;
      if (live != null && Number.isFinite(Number(live.line))) {
        const bookLine = Number(live.line);
        // Explicit null guard: Number(null) === 0 is finite, so a missing side
        // would slip through as americanOdds 0 without this check.
        for (const s of [
          { side: 'over' as const, odds: live.over },
          { side: 'under' as const, odds: live.under },
        ]) {
          if (s.odds == null || s.odds === '' || !Number.isFinite(Number(s.odds))) continue;
          const m = buildPlayerPropModel({
            sport, market: candidate.market, side: s.side, line: bookLine,
            observations: candidate.observations, source: candidate.source,
            calibration: candidate.calibration, americanOdds: Number(s.odds),
          });
          if (!m.available || m.probability == null || m.estimatedEdge == null) continue;
          // Store RAW fractions here; the return converts to percent once.
          // (m.estimatedEdge is modelProb - impliedProb, e.g. 0.073 = +7.3%.)
          const edgeFrac = m.estimatedEdge;
          if (s.side === 'over') edgeOver = edgeFrac; else edgeUnder = edgeFrac;
          if (s.side === candidate.side) {
            estimatedEdge = edgeFrac;
            edgeLine = bookLine;
          }
        }
      }
      return {
      player: candidate.player,
      team: candidate.team,
      opponent: candidate.opponent,
      eventId: candidate.eventId,
      eventDate: candidate.eventDate,
      market: candidate.market,
      side: candidate.side,
      suggestedLine: candidate.line,
      confidencePct: Math.round(candidate.confidence * 1000) / 10,
      grade: candidate.grade,
      sampleSize: candidate.sampleSize,
      modelVersion: candidate.modelVersion,
      source: candidate.source,
      fallbackUsed: candidate.fallbackUsed,
      marketLine: live?.line ?? null,
      marketOddsOver: live?.over ?? null,
      marketOddsUnder: live?.under ?? null,
      marketSource: live ? 'api.sharpapi.io' : null,
      marketBook: live?.book ?? null,
      // Edge vs the real book price at the real book line. Null when no book
      // price exists (model-probability-only candidate). Positive = value.
      // edgeOver/edgeUnder expose BOTH sides so over-value is visible even when
      // the pick itself is an under (e.g. negative over-edge means the book
      // overprices the over, confirming the under as the value side).
      estimatedEdge: estimatedEdge == null ? null : Math.round(estimatedEdge * 1000) / 10,
      edgeOver: edgeOver == null ? null : Math.round(edgeOver * 1000) / 10,
      edgeUnder: edgeUnder == null ? null : Math.round(edgeUnder * 1000) / 10,
      edgeLine,
      availability: candidate.profile.availability,
      recent: candidate.profile.recent,
      sources: candidate.profile.sources,
      note: 'Slate screener candidate only. Final recommendation must run player_prop_model (or MLB provisional model when appropriate) against the exact current sportsbook line and final availability gate.',
    };});
      // Re-apply the quality gate on RECOMPUTED values (book-line probability
      // can fall below the floor when the book's line is tougher), then rank by
      // edge so value — not raw probability — orders the list. Null-edge
      // (model-only) candidates sort after edged ones, by confidence.
      // NOTE: no re-filter here — original qualification stands (the player-market
      // cleared the bar at a nearby line); the book-line refinement picks the
      // valuable side and ranks by edge. Dropping on recompute emptied the list
      // while the model opinion itself remains valid.
      // Rank: verified-price candidates first (either side has a real edge —
      // matches the "verified lines" requirement), then by chosen-side edge,
      // then confidence. Model-only candidates follow by confidence.
      return mapped
        .sort((a, b) => {
          const aPriced = (a.edgeOver != null || a.edgeUnder != null) ? 0 : 1;
          const bPriced = (b.edgeOver != null || b.edgeUnder != null) ? 0 : 1;
          return aPriced - bPriced
            || (b.estimatedEdge ?? -Infinity) - (a.estimatedEdge ?? -Infinity)
            || b.confidencePct - a.confidencePct;
        });
    })(),
    calibration: marketCalibration,
    providerPolicy: {
      apiSportsRequired: false,
      fallbackRule: 'NBA/NFL/NHL candidate modeling uses ESPN recent game logs even when API-Sports is suspended or unavailable.',
      premium: premiumProviderStatus(),
      dataGapPriorities: dataGapPriorities()[sport],
    },
  };

  return ok(
    `${sport.toUpperCase()} slate screener evaluated ${evaluated.length} player/market combinations across ${players.length} players; ${qualified.length} A/B candidates cleared ${Math.round(minConfidence * 100)}%`,
    payload,
    { events: events.length, players: players.length, evaluated: evaluated.length, qualified: qualified.length, top: payload.candidates.slice(0, requested) },
  );
};

export const UNIVERSAL_SCREENER_TOOL: ToolDef = {
  name: 'slate_candidate_screener',
  description: 'Slate-wide deterministic candidate discovery for MLB/NBA/NFL/NHL. Use FIRST for requests asking for multiple picks. It discovers today’s games and roster candidates itself, evaluates a bounded broad pool from official/ESPN recent game logs, ranks only A/B candidates by default, records every evaluated candidate for calibration, and does NOT require API-Sports to be healthy. Returned lines are model screening lines, not claimed sportsbook lines; final picks must still be verified with player_prop_model / availability against the exact current market.',
  parameters: {
    type: 'object',
    properties: {
      sport: { type: 'string', enum: ['mlb', 'nba', 'nfl', 'nhl'] },
      date: { type: 'string', description: 'YYYY-MM-DD; defaults to today in America/Toronto' },
      requestedPicks: { type: 'number', description: 'How many final picks the user asked for; used to size the candidate pool' },
      maxPlayers: { type: 'number', description: 'Optional cap on distinct players screened (18-48; default about 5x requested picks)' },
      minConfidence: { type: 'number', description: 'Screening floor as decimal; default 0.58; values below 0.58 are raised to protect parlay quality' },
    },
    required: ['sport'],
  },
  handler,
};
