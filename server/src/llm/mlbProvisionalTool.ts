import type { ToolDef, ToolOutcome } from './tools.js';
import * as mlb from '../providers/mlbStatsApi.js';
import * as availability from '../providers/playerAvailability.js';
import { buildPlayerPropModel, mlbObservation, normalizeMarket, type HistoricalObservation } from '../models/playerPropModel.js';
import { loadLearning } from '../lib/predictionStore.js';

function unavail(reason: string): ToolOutcome {
  return { available: false, reason, summary: `unavailable: ${reason}`, data: { available: false, reason }, payload: { available: false, reason } };
}

function round(value: number, places = 1): number {
  return Math.round(value * 10 ** places) / 10 ** places;
}

async function handler(args: any): Promise<ToolOutcome> {
  const player = String(args?.player ?? '').trim();
  const market = normalizeMarket(String(args?.market ?? ''));
  const side = String(args?.side ?? 'over').toLowerCase() === 'under' ? 'under' : 'over';
  const line = Number(args?.line);
  const oddsValue = args?.odds == null || String(args.odds).trim() === ''
    ? null : Number(String(args.odds).replace(/−/g, '-').replace('+', ''));
  const americanOdds = Number.isFinite(oddsValue) && oddsValue !== 0 ? oddsValue : null;
  if (!player) return unavail('no player name provided');
  if (!market) return unavail('no prop market provided');
  if (!Number.isFinite(line) || line < 0) return unavail('a valid non-negative sportsbook line is required');

  const status = await availability.verifyRecommendationAvailability({
    player,
    sport: 'mlb',
    team: args?.team,
    date: typeof args?.date === 'string' ? args.date : new Date().toISOString().slice(0, 10),
    gamePk: Number(args?.gamePk) || null,
    eventId: args?.eventId ?? null,
  });

  // Hard stop remains for injury/roster failures. The only relaxed condition
  // here is game-day lineup confirmation: an active, injury-cleared player can
  // be modeled provisionally before batting orders are posted.
  if (!status.rosterAndInjuryEligible) {
    return unavail(`MLB roster/injury gate failed for ${status.player}: ${status.reason}`);
  }

  const found = await mlb.searchPlayer(player);
  if (!found.available || !found.data) return unavail(found.reason ?? 'official MLB player not found');
  const pitcherMarkets = new Set(['strikeouts', 'earnedRuns', 'hitsAllowed', 'walksAllowed', 'outsRecorded']);
  const group = pitcherMarkets.has(market) ? 'pitching' : 'hitting';
  const log = await mlb.getGameLog(found.data.id, group, mlb.CURRENT_SEASON, 20);
  if (!log.available || !Array.isArray(log.data)) return unavail(log.reason ?? 'official MLB game log unavailable');
  const observations: HistoricalObservation[] = log.data.flatMap((game: any): HistoricalObservation[] => {
    const value = mlbObservation(market, game.stat ?? {});
    return value == null || !Number.isFinite(value) ? [] : [{ date: game.date ?? null, value }];
  });

  let calibration = null;
  try {
    const learning = await loadLearning();
    const learned = learning?.perSportMarket?.[`MLB:${market}`];
    if (learned) calibration = { n: learned.n, averageConfidence: learned.averageConfidence ?? null, hitRate: learned.hitRate };
  } catch {
    // Historical model remains usable if optional learning state is unavailable.
  }

  const model = buildPlayerPropModel({
    sport: 'mlb', market, side, line, observations, americanOdds,
    source: 'statsapi.mlb.com official gameLog', calibration,
  });
  const provisional = !status.recommendationEligible;
  const payload = {
    ...model,
    player: found.data.fullName,
    playerId: found.data.id,
    provisional,
    finalRecommendationEligible: status.recommendationEligible,
    availability: {
      rosterAndInjuryEligible: status.rosterAndInjuryEligible,
      finalRecommendationEligible: status.recommendationEligible,
      playingStatus: status.playingStatus,
      checkedAt: status.checkedAt,
      gameDay: status.gameDay,
    },
    observations: observations.map((row) => ({ date: row.date ?? null, value: row.value })),
    rule: provisional
      ? 'PROVISIONAL MLB GRADE: valid for ranking/analysis because roster and injury status passed, but re-check lineup before bet placement. Do not call it lineup-confirmed.'
      : 'FINAL-ELIGIBLE MLB GRADE: roster/injury and current game-day confirmation passed. Re-check near lock because statuses can still change.',
  };
  if (!model.available) {
    return { available: false, reason: model.reason, summary: `model unavailable: ${model.reason}`, data: payload, payload };
  }
  const probability = round((model.probability ?? 0) * 100, 1);
  return {
    available: true,
    summary: `${provisional ? 'Provisional ' : ''}MLB ${found.data.fullName} ${side} ${line} ${market}: ${probability}% from ${model.sampleSize} official games (${model.grade})`,
    data: {
      player: found.data.fullName,
      sport: 'mlb', market, side, line,
      probability: model.probability,
      grade: model.grade,
      sampleSize: model.sampleSize,
      impliedProbability: model.impliedProbability,
      estimatedEdge: model.estimatedEdge,
      modelVersion: model.modelVersion,
      source: model.source,
      provisional,
      finalRecommendationEligible: status.recommendationEligible,
      eventDate: String(args?.date ?? new Date().toISOString().slice(0, 10)).slice(0, 10),
      eventId: String(status.gameDay.gamePk ?? ''),
      gameDayReason: status.gameDay.reason,
    },
    payload,
  };
}

export const MLB_PROVISIONAL_TOOL: ToolDef = {
  name: 'mlb_provisional_prop_model',
  description: 'MLB-only pre-lineup prop model. Use when the user asks to grade/rank today\'s MLB props before official batting orders are posted and player_prop_model is blocked only by lineup confirmation. It STILL hard-blocks injured/inactive/unverified-roster players, but computes a transparent provisional grade from official MLB game logs for active injury-cleared players. provisional=true means rank/analyze the candidate and label it PRE-LINEUP; re-check player_availability before treating it as final or placing the bet.',
  parameters: {
    type: 'object',
    properties: {
      player: { type: 'string', description: 'Full MLB player name' },
      market: { type: 'string', description: 'Exact market, e.g. hits, total_bases, home_runs, strikeouts' },
      side: { type: 'string', enum: ['over', 'under'] },
      line: { type: 'number', description: 'Exact sportsbook prop line' },
      odds: { type: 'number', description: 'Optional verified American odds for this exact prop' },
      team: { type: 'string', description: 'Optional MLB team name' },
      date: { type: 'string', description: 'Event date YYYY-MM-DD' },
      gamePk: { type: 'number', description: 'Official MLB gamePk when known' },
      eventId: { type: 'string', description: 'Optional official event/game identifier' },
    },
    required: ['player', 'market', 'side', 'line'],
  },
  handler,
};
