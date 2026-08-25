import * as mlb from '../providers/mlbStatsApi.js';
import * as espn from '../providers/espn.js';
import { getSgoSlateEvents, type SgoSlateEvent, type SgoSlateProp } from '../providers/sportsGameOdds.js';
import { buildPlayerPropModel, espnObservation, mlbObservation, normalizeMarket, type HistoricalObservation, type ModelSport } from '../models/playerPropModel.js';
import { recordCandidateEvaluations } from '../candidates/candidateHistory.js';
import { loadLearning } from '../lib/predictionStore.js';
import { verifyRecommendationAvailability } from '../providers/playerAvailability.js';
import type { ToolDef, ToolOutcome } from './tools.js';

const ESPN_MAP: Record<Exclude<ModelSport, 'mlb'>, espn.EspnSport> = {
  nba: 'basketball/nba', nfl: 'football/nfl', nhl: 'hockey/nhl',
};

function ok(summary: string, payload: any): ToolOutcome {
  return { available: true, summary, data: payload, payload };
}
function unavailable(reason: string): ToolOutcome {
  return { available: false, reason, summary: `unavailable: ${reason}`, data: { available: false, reason }, payload: { available: false, reason } };
}
function torontoToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function requestedDate(value: unknown): string {
  const text = String(value ?? '').slice(0, 10);
  return /^\\d{4}-\\d{2}-\\d{2}$/.test(text) ? text : torontoToday();
}
function sportKey(value: string): ModelSport {
  return String(value || 'mlb').toLowerCase() as ModelSport;
}
function oddsNumber(value: number | null): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function calibrationFor(learning: any, sport: ModelSport, market: string) {
  const keys = [`${sport}:${market}`, `${sport.toUpperCase()}:${market}`, `${sport}|${market}`, market];
  for (const key of keys) {
    const row = learning?.perSportMarket?.[key] ?? learning?.perMarket?.[key];
    if (row) return { n: row.n, averageConfidence: row.averageConfidence ?? null, hitRate: row.hitRate };
  }
  return null;
}
function propName(prop: SgoSlateProp): string {
  return prop.playerName.trim() || prop.playerId.replace(/_\\d+_(?:MLB|NBA|NFL|NHL)$/i, '').replace(/_/g, ' ');
}
function marketFor(prop: SgoSlateProp): string {
  const raw = prop.market.toLowerCase();
  const aliases: Record<string, string> = {
    batting_hits: 'hits', hits: 'hits', total_bases: 'totalBases', totalbases: 'totalBases',
    home_runs: 'homeRuns', homeruns: 'homeRuns', rbis: 'rbi', runs_batted_in: 'rbi',
    strikeouts: 'strikeouts', pitcher_strikeouts: 'strikeouts', pitching_strikeouts: 'strikeouts',
    points: 'points', rebounds: 'rebounds', assists: 'assists', three_pointers: 'threePointersMade',
    passing_yards: 'passingYards', rushing_yards: 'rushingYards', receiving_yards: 'receivingYards',
    receptions: 'receptions', shots_on_goal: 'shotsOnGoal', saves: 'saves', goals: 'goals',
  };
  return normalizeMarket(aliases[raw] ?? raw.replace(/-/g, '_'));
}
async function historyFor(name: string, sport: ModelSport, market: string): Promise<{ source: string; observations: HistoricalObservation[]; season: any } | null> {
  if (sport === 'mlb') {
    const found = await mlb.searchPlayer(name);
    if (!found.available || !found.data) return null;
    const pitching = ['strikeouts', 'outsRecorded', 'earnedRuns', 'hitsAllowed', 'walksAllowed'].includes(normalizeMarket(market));
    const log = await mlb.getGameLog(found.data.id, pitching ? 'pitching' : 'hitting', mlb.CURRENT_SEASON, 20);
    if (!log.available || !Array.isArray(log.data)) return null;
    const observations = log.data.map((game: any) => {
      const value = mlbObservation(market, game.stat ?? {});
      return value == null ? null : { date: game.date ?? null, value };
    }).filter(Boolean) as HistoricalObservation[];
    return { source: 'statsapi.mlb.com', observations, season: { playerId: found.data.id, season: mlb.CURRENT_SEASON } };
  }
  const league = ESPN_MAP[sport as Exclude<ModelSport, 'mlb'>];
  const found = await espn.findPlayer(name, league);
  if (!found.available || !found.player) return null;
  const log = await espn.getGamelog(found.player.id, league, 20);
  if (!log.available || !Array.isArray(log.games)) return null;
  const observations = log.games.map((game: any) => {
    const value = espnObservation(sport as Exclude<ModelSport, 'mlb'>, market, game.stats ?? {});
    return value == null ? null : { date: game.date ?? game.gameDate ?? null, value };
  }).filter(Boolean) as HistoricalObservation[];
  return { source: 'site.web.api.espn.com', observations, season: { season: log.season ?? null } };
}
function uniqueProps(events: SgoSlateEvent[], max: number): Array<{ event: SgoSlateEvent; prop: SgoSlateProp }> {
  const seen = new Set<string>();
  const rows: Array<{ event: SgoSlateEvent; prop: SgoSlateProp }> = [];
  for (const event of events) {
    for (const prop of event.props) {
      if (prop.line == null || prop.odds == null) continue;
      const market = marketFor(prop);
      const name = propName(prop);
      if (!name || !market) continue;
      const key = `${name.toLowerCase()}|${market}|${prop.line}|${prop.side}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push({ event, prop: { ...prop, playerName: name, market } });
      if (rows.length >= max) return rows;
    }
  }
  return rows;
}

const handler = async (args: any): Promise<ToolOutcome> => {
  const sport = sportKey(args?.sport);
  if (!['mlb', 'nba', 'nfl', 'nhl'].includes(sport)) return unavailable(`unsupported sport ${sport}`);
  const date = requestedDate(args?.date);
  const requested = Math.min(10, Math.max(1, Number(args?.requestedPicks ?? 5) || 5));
  const maxPlayers = Math.min(8, Math.max(5, Number(args?.maxPlayers ?? 6) || 6));
  const minConfidence = Math.max(0.5, Math.min(0.75, Number(args?.minConfidence ?? 0.54) || 0.54));

  const slate = await getSgoSlateEvents(sport, 10);
  if (!slate.available || !slate.events.length) return unavailable(slate.reason ?? 'SportsGameOdds returned no live events');
  const liveProps = uniqueProps(slate.events, maxPlayers);
  if (!liveProps.length) return unavailable('SportsGameOdds returned events but no usable player props with current lines');

  const learning = await loadLearning().catch(() => null);
  const historyCache = new Map<string, Promise<any>>();
  const evaluated: any[] = [];
  await Promise.all(liveProps.map(async ({ event, prop }) => {
    const market = marketFor(prop);
    const name = propName(prop);
    const cacheKey = `${sport}|${name}|${market}`;
    let history = historyCache.get(cacheKey);
    if (!history) {
      history = historyFor(name, sport, market).catch(() => null);
      historyCache.set(cacheKey, history);
    }
    const loaded = await history;
    if (!loaded || loaded.observations.length < 5 || prop.line == null) return;
    const calibration = calibrationFor(learning, sport, market);
    const model = buildPlayerPropModel({
      sport, market, side: prop.side, line: prop.line, observations: loaded.observations,
      source: loaded.source, calibration,
    });
    if (!model.available || model.probability == null || !model.grade) return;
    evaluated.push({
      event, prop, model, source: loaded.source,
      eventDate: event.commenceTime.slice(0, 10) || date,
      team: event.home,
      opponent: event.away,
    });
  }));

  if (!evaluated.length) return unavailable('Live props were found, but none had enough compatible historical player data for the deterministic model');

  await recordCandidateEvaluations(evaluated.map((row) => ({
    eventDate: row.eventDate, eventId: row.event.id, sport, player: propName(row.prop),
    team: row.team, opponent: row.opponent, market: marketFor(row.prop), side: row.prop.side,
    line: row.prop.line, modelProbability: row.model.probability, grade: row.model.grade,
    sampleSize: row.model.sampleSize, modelVersion: row.model.modelVersion, modelSource: row.source,
    sources: [row.source, 'api.sportsgameodds.com'], fallbackUsed: row.source !== 'statsapi.mlb.com',
    metadata: { odds: row.prop.odds, fairOdds: row.prop.fairOdds },
  }))).catch(() => {});

  const qualified = evaluated
    .filter((row) => row.model.grade !== 'D' && (row.model.probability ?? 0) >= minConfidence)
    .sort((a, b) => (b.model.probability ?? 0) - (a.model.probability ?? 0) || b.model.sampleSize - a.model.sampleSize);

  // Never expose a live candidate as recommendation-ready until its current
  // roster, injury, event, and (for MLB) lineup status has passed the gate.
  const gated = (await Promise.all(
    qualified.slice(0, Math.max(requested * 3, 12)).map(async (row) => {
      const availability = await verifyRecommendationAvailability({
        player: propName(row.prop),
        sport,
        date: row.eventDate,
      }).catch((error: unknown) => ({
        recommendationEligible: false,
        reason: error instanceof Error ? error.message : 'availability check failed',
      }));
      return availability.recommendationEligible ? { ...row, availability } : null;
    }),
  )).filter((row): row is NonNullable<typeof row> => row !== null);

  if (!gated.length) {
    return unavailable('Live props cleared the model threshold, but no player passed the current roster, injury, event, and lineup gates');
  }

  const candidates = gated.slice(0, Math.max(requested * 2, 10)).map((row) => ({
    player: propName(row.prop), playerId: row.prop.playerId, sport, market: marketFor(row.prop),
    side: row.prop.side, line: row.prop.line, odds: oddsNumber(row.prop.odds), fairOdds: oddsNumber(row.prop.fairOdds),
    team: row.team, opponent: row.opponent, eventId: row.event.id, eventDate: row.eventDate,
    confidencePct: Math.round((row.model.probability ?? 0) * 1000) / 10, grade: row.model.grade,
    sampleSize: row.model.sampleSize, modelVersion: row.model.modelVersion, modelSource: row.source,
    availability: row.availability,
    sources: [row.source, 'api.sportsgameodds.com'],
    note: 'Live sportsbook line and odds were used. Current availability and lineup validation passed immediately before emission; re-check close to lock.',
  }));

  return ok(
    `${sport.toUpperCase()} live screener evaluated ${evaluated.length} real live props across ${slate.events.length} events; ${gated.length} passed model and availability gates at ${Math.round(minConfidence * 100)}%`,
    { available: true, sport, date, provider: 'api.sportsgameodds.com', slate: { events: slate.events.length, liveProps: liveProps.length, modelEvaluations: evaluated.length, qualifiedCandidates: gated.length, gatedCandidates: gated.length }, candidates, partial: gated.length < requested, notice: slate.notice ?? null },
  );
};

export const FAST_SLATE_SCREENER_TOOL: ToolDef = {
  name: 'slate_candidate_screener',
  description: 'Bounded live slate screener. It bulk-fetches real SportsGameOdds events and player props, evaluates only those live lines with the deterministic historical model, and returns ranked candidates for final availability/lineup validation. It may return a partial result when a provider lacks data.',
  parameters: {
    type: 'object',
    properties: {
      sport: { type: 'string', enum: ['mlb', 'nba', 'nfl', 'nhl'] },
      date: { type: 'string', description: 'YYYY-MM-DD; defaults to today in America/Toronto' },
      requestedPicks: { type: 'number', description: 'Target number of candidates' },
      minConfidence: { type: 'number', description: 'Minimum decimal model probability; default 0.54' },
    },
    required: ['sport'],
  },
  handler,
};
