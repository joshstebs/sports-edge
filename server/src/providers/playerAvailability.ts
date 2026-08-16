// Cross-sport player availability gate for betting recommendations.
// A roster's "Active" flag alone is not enough: ESPN often keeps injured
// players active while listing Day-To-Day/Questionable/Out separately. We
// require BOTH a current roster verification and a successful league injury
// report check. Any missing or ambiguous signal fails closed.

import * as espn from './espn.js';
import * as mlb from './mlbStatsApi.js';
import { normalizeName } from './http.js';

export type SportKey = 'mlb' | 'nfl' | 'nba' | 'nhl';
export type PlayingStatus = 'active' | 'questionable' | 'doubtful' | 'out' | 'inactive' | 'suspended' | 'unknown';

const ESPN_SPORTS: Record<SportKey, espn.EspnSport> = {
  mlb: 'baseball/mlb',
  nfl: 'football/nfl',
  nba: 'basketball/nba',
  nhl: 'hockey/nhl',
};

export interface PlayerAvailability {
  player: string;
  sport: SportKey | 'unknown';
  team: string | null;
  teamId: string | null;
  position: string | null;
  playingStatus: PlayingStatus;
  recommendationEligible: boolean;
  statusVerified: boolean;
  rosterVerified: boolean;
  injuryReportVerified: boolean;
  listedInInjuryReport: boolean;
  rosterStatus: string | null;
  injuries: espn.EspnInjury[];
  checkedAt: string;
  sources: string[];
  reason: string;
}

export interface RecommendationAvailabilityInput {
  player: string;
  sport: SportKey | string;
  team?: string | null;
  date?: string | null;
  gamePk?: number | null;
  eventId?: string | number | null;
}

export interface GameDayAvailability {
  required: boolean;
  verified: boolean;
  confirmedInLineup: boolean | null;
  gamePk: number | null;
  eventId?: string | null;
  team?: string | null;
  role?: 'probable pitcher' | 'batting order' | null;
  reason: string;
}

export interface RecommendationAvailability extends PlayerAvailability {
  rosterAndInjuryEligible: boolean;
  gameDay: GameDayAvailability;
  rule: string;
}

function injuryMatches(name: string, injuries: espn.EspnInjury[]): espn.EspnInjury[] {
  const target = normalizeName(name);
  const exact = injuries.filter((i) => normalizeName(i.playerName) === target);
  if (exact.length) return exact;
  // Permit a partial only when it identifies exactly one player. This supports
  // common suffix omissions without confusing similarly named athletes.
  const partial = injuries.filter((i) => {
    const candidate = normalizeName(i.playerName);
    return candidate.includes(target) || target.includes(candidate);
  });
  const names = new Set(partial.map((i) => normalizeName(i.playerName)));
  return names.size === 1 ? partial : [];
}

function classifyInjury(status: string): PlayingStatus {
  const s = status.toLowerCase();
  if (/suspend/.test(s)) return 'suspended';
  if (/out|injured reserve|\bil\b|disabled|inactive|not active/.test(s)) return 'out';
  if (/doubt/.test(s)) return 'doubtful';
  // Any open injury designation, including probable/day-to-day, is treated as
  // uncertain for a player-prop recommendation until cleared.
  return 'questionable';
}

function nonActiveRoster(status: string | null): PlayingStatus {
  const s = String(status ?? '').toLowerCase();
  if (/suspend/.test(s)) return 'suspended';
  if (/injur|reserve|out|disabled|inactive|rehab|bereavement|paternity/.test(s)) return 'inactive';
  return 'unknown';
}

export async function checkPlayerAvailability(name: string, sport: SportKey): Promise<PlayerAvailability> {
  const checkedAt = new Date().toISOString();
  const espnSport = ESPN_SPORTS[sport];
  const injuryReport = await espn.getLeagueInjuries(espnSport);
  const injuries = injuryReport.available ? injuryMatches(name, injuryReport.injuries) : [];
  const injuryStatus = injuries.length ? classifyInjury(injuries[0].status) : null;

  if (sport === 'mlb') {
    const found = await mlb.searchPlayer(name);
    const official = found.available && found.data ? await mlb.getPlayerStatus(found.data.id) : null;
    const rosterVerified = Boolean(official?.available && official.data);
    const rosterActive = Boolean(official?.data?.isActive);
    const statusVerified = rosterVerified && injuryReport.available;
    const playingStatus: PlayingStatus = injuryStatus ?? (rosterActive ? 'active' : nonActiveRoster(official?.data?.rosterStatus ?? null));
    const recommendationEligible = statusVerified && rosterActive && injuries.length === 0;
    const reason = !injuryReport.available
      ? `Not eligible: current injury report unavailable (${injuryReport.reason ?? 'unknown error'}).`
      : injuries.length
        ? `Not eligible: listed ${injuries[0].status} on the current ESPN injury report.`
        : !rosterVerified
          ? `Not eligible: official MLB roster status unavailable (${official?.reason ?? found.reason ?? 'player not found'}).`
          : !rosterActive
            ? `Not eligible: official MLB roster status is ${official?.data?.rosterStatus ?? 'not active'}.`
            : 'Eligible at check time: official MLB roster is active and player is absent from the current ESPN injury report.';
    return {
      player: official?.data?.fullName ?? found.data?.fullName ?? name,
      sport,
      team: official?.data?.teamName ?? null,
      teamId: official?.data?.teamId != null ? String(official.data.teamId) : null,
      position: null,
      playingStatus,
      recommendationEligible,
      statusVerified,
      rosterVerified,
      injuryReportVerified: injuryReport.available,
      listedInInjuryReport: injuries.length > 0,
      rosterStatus: official?.data?.rosterStatus ?? null,
      injuries,
      checkedAt: injuryReport.checkedAt || checkedAt,
      sources: ['statsapi.mlb.com (official roster)', 'site.web.api.espn.com (league injury report)'],
      reason,
    };
  }

  const found = await espn.findPlayer(name, espnSport);
  const roster = found.player;
  const rosterStatus = roster?.rosterStatus?.name ?? roster?.rosterStatus?.type ?? null;
  const rosterVerified = Boolean(found.available && roster && found.coverage?.failed === 0);
  const rosterActive = rosterVerified && String(rosterStatus ?? '').toLowerCase() === 'active';
  const statusVerified = rosterVerified && injuryReport.available;
  const playingStatus: PlayingStatus = injuryStatus ?? (rosterActive ? 'active' : nonActiveRoster(rosterStatus));
  const recommendationEligible = statusVerified && rosterActive && injuries.length === 0 && roster?.injuries.length === 0;
  const embeddedInjury = roster?.injuries?.[0];
  const reason = !injuryReport.available
    ? `Not eligible: current injury report unavailable (${injuryReport.reason ?? 'unknown error'}).`
    : injuries.length
      ? `Not eligible: listed ${injuries[0].status} on the current ESPN injury report.`
      : !found.available
        ? `Not eligible: current roster verification failed (${found.reason ?? 'player not found'}).`
        : !rosterVerified
          ? `Not eligible: roster coverage was incomplete (${found.coverage?.failed ?? 'unknown'} team feeds failed).`
          : !rosterActive
            ? `Not eligible: roster status is ${rosterStatus ?? 'unknown'}.`
            : embeddedInjury
              ? `Not eligible: roster carries an injury designation (${embeddedInjury.status ?? 'unknown'}).`
              : 'Eligible at check time: roster is active and player is absent from the current ESPN injury report.';
  return {
    player: roster?.displayName ?? injuries[0]?.playerName ?? name,
    sport,
    team: roster?.teamName ?? injuries[0]?.teamName ?? null,
    teamId: roster?.teamId ?? injuries[0]?.teamId ?? null,
    position: roster?.position ?? null,
    playingStatus: embeddedInjury && !injuryStatus ? classifyInjury(embeddedInjury.status ?? 'unknown') : playingStatus,
    recommendationEligible,
    statusVerified,
    rosterVerified,
    injuryReportVerified: injuryReport.available,
    listedInInjuryReport: injuries.length > 0 || Boolean(embeddedInjury),
    rosterStatus,
    injuries,
    checkedAt: injuryReport.checkedAt || checkedAt,
    sources: ['site.web.api.espn.com (current roster + league injury report)'],
    reason,
  };
}

/** Deterministic final gate for an emitted recommendation leg. Callers MUST
 * accept the leg only when recommendationEligible === true. For MLB, this also
 * resolves today's game and requires a confirmed batting-order/probable-
 * pitcher match; pre-lineup recommendations therefore fail closed. */
export async function verifyRecommendationAvailability(
  input: RecommendationAvailabilityInput
): Promise<RecommendationAvailability> {
  const sport = typeof input.sport === 'string' ? parseSportKey(input.sport) : input.sport;
  if (!sport) return unknownRecommendation(input.player, String(input.sport), 'unsupported sport');
  const status = await checkPlayerAvailability(input.player, sport);
  let gameDay: GameDayAvailability = {
    required: true,
    verified: false,
    confirmedInLineup: sport === 'mlb' ? false : null,
    gamePk: null,
    reason: sport === 'mlb'
      ? 'MLB player props require the player in a confirmed batting order or listed as probable pitcher.'
      : 'Player props require one exact pregame event and a current event injury report.',
  };

  if (sport === 'mlb') {
    const date = String(input.date ?? new Date().toISOString().slice(0, 10));
    let gamePk = Number(input.gamePk ?? input.eventId) || null;
    let scheduledGame: any | null = null;
    const scheduleResult = await mlb.getSchedule(date, date);
    const team = mlb.matchTeamName(String(input.team ?? status.team ?? ''));
    if (!gamePk && status.team) {
      const games = scheduleResult.data?.filter((g) => !team || g.away.name === team || g.home.name === team) ?? [];
      if (games.length === 1) {
        scheduledGame = games[0];
        gamePk = games[0].gamePk;
      }
      if (!gamePk) {
        gameDay.reason = scheduleResult.available && games.length > 1
          ? `Multiple MLB games found for ${team ?? status.team} on ${date}; an exact gamePk is required.`
          : scheduleResult.available
            ? `No MLB game found for ${team ?? status.team} on ${date}.`
          : `MLB schedule unavailable for ${date}: ${scheduleResult.reason ?? 'unknown error'}.`;
      }
    }
    if (gamePk) {
      scheduledGame ??= scheduleResult.data?.find((g) => g.gamePk === gamePk) ?? null;
      if (!scheduleResult.available || !scheduledGame) {
        gameDay.reason = !scheduleResult.available
          ? `MLB schedule unavailable for ${date}: ${scheduleResult.reason ?? 'unknown error'}.`
          : `Game ${gamePk} is not scheduled on ${date}.`;
        return { ...status, recommendationEligible: false, rosterAndInjuryEligible: status.recommendationEligible, gameDay, rule: 'FAIL CLOSED: do not recommend, persist, or add this player prop.' };
      }
      if (team && scheduledGame.away.name !== team && scheduledGame.home.name !== team) {
        gameDay.reason = `Game ${gamePk} does not include ${team}.`;
        return { ...status, recommendationEligible: false, rosterAndInjuryEligible: status.recommendationEligible, gameDay, rule: 'FAIL CLOSED: do not recommend, persist, or add this player prop.' };
      }
      const gameState = String(scheduledGame.status ?? '');
      const detailedState = String(scheduledGame.detailedState ?? gameState);
      if (!/^scheduled$/i.test(gameState) || !/^(?:scheduled|pre-game|warmup)$/i.test(detailedState)) {
        gameDay.reason = `Game ${gamePk} is ${detailedState || gameState || 'not in a recommendable pregame state'}.`;
        return { ...status, recommendationEligible: false, rosterAndInjuryEligible: status.recommendationEligible, gameDay, rule: 'FAIL CLOSED: do not recommend, persist, or add this player prop.' };
      }
      const lineup = await mlb.getLineups(gamePk);
      gameDay.gamePk = gamePk;
      if (!lineup.available || !lineup.data) {
        gameDay.reason = `Confirmed lineup unavailable: ${lineup.reason ?? 'boxscore unavailable'}.`;
      } else {
        const normalizedPlayer = normalizeName(status.player);
        const sides = [lineup.data.away, lineup.data.home];
        const teamName = team;
        const side = sides.find((s: any) => !teamName || s?.team?.name === teamName);
        const lineupPosted = Boolean(side?.lineupsPosted);
        const batterConfirmed = Boolean(side?.battingOrder?.some((p: any) => normalizeName(p.fullName) === normalizedPlayer));
        const pitcherConfirmed = normalizeName(side?.probablePitcher?.fullName ?? '') === normalizedPlayer;
        gameDay = {
          required: true,
          verified: lineupPosted,
          confirmedInLineup: batterConfirmed || pitcherConfirmed,
          role: pitcherConfirmed ? 'probable pitcher' : batterConfirmed ? 'batting order' : null,
          gamePk,
          team: side?.team?.name ?? teamName ?? status.team,
          reason: !lineupPosted
            ? 'Confirmed lineup has not been posted; do not recommend this player prop yet.'
            : batterConfirmed || pitcherConfirmed
              ? `Confirmed as ${pitcherConfirmed ? 'probable pitcher' : 'in the batting order'} in the MLB boxscore.`
              : 'Player is not in the confirmed batting order and is not the listed probable pitcher.',
        };
      }
    }
  } else {
    const date = String(input.date ?? new Date().toISOString().slice(0, 10)).slice(0, 10);
    if (!status.teamId) {
      gameDay.reason = 'The player current team could not be resolved for an event-specific status check.';
    } else {
      const event = await espn.getGameDayStatus(
        ESPN_SPORTS[sport],
        status.player,
        status.teamId,
        date,
        input.eventId ?? input.gamePk ?? null,
      );
      if (!event.available || !event.data) {
        gameDay.reason = event.reason ?? 'Event-specific game-day status is unavailable.';
      } else if (event.data.playerListedInEventInjuries) {
        gameDay = {
          required: true,
          verified: false,
          confirmedInLineup: false,
          gamePk: null,
          eventId: event.data.eventId,
          team: status.team,
          reason: `Player is listed ${event.data.playerEventInjuryStatus ?? 'injured'} on the event injury report.`,
        };
      } else {
        gameDay = {
          required: true,
          verified: true,
          confirmedInLineup: null,
          gamePk: null,
          eventId: event.data.eventId,
          team: status.team,
          reason: `Exact event ${event.data.eventId} is pregame and the player is absent from its current injury report.`,
        };
      }
    }
  }

  const recommendationEligible = status.recommendationEligible && gameDay.verified && gameDay.confirmedInLineup !== false;
  return {
    ...status,
    recommendationEligible,
    rosterAndInjuryEligible: status.recommendationEligible,
    gameDay,
    rule: recommendationEligible
      ? 'Player passed the current availability gate. Re-check close to lock because statuses can change.'
      : 'FAIL CLOSED: do not recommend, persist, or add this player prop. It may only be discussed conditionally pending clearance/confirmation.',
  };
}

function unknownRecommendation(player: string, sport: string, reason: string): RecommendationAvailability {
  return {
    player,
    sport: 'unknown',
    team: null,
    teamId: null,
    position: null,
    playingStatus: 'unknown',
    recommendationEligible: false,
    statusVerified: false,
    rosterVerified: false,
    injuryReportVerified: false,
    listedInInjuryReport: false,
    rosterStatus: null,
    injuries: [],
    checkedAt: new Date().toISOString(),
    sources: [],
    reason: `Not eligible: ${reason} (${sport}).`,
    rosterAndInjuryEligible: false,
    gameDay: { required: true, verified: false, confirmedInLineup: false, gamePk: null, reason },
    rule: 'FAIL CLOSED: do not recommend, persist, or add this player prop.',
  };
}

/** Conservative parser for the current SGP selection schema:
 * "Player Name OVER 1.5 Total Bases". Returns null rather than guessing. */
export function playerFromSelection(selection: unknown): string | null {
  const text = String(selection ?? '').trim();
  const match = text.match(/^(.+?)\s+(?:OVER|UNDER)\s+[+-]?(?:\d+(?:\.\d+)?|\.\d+)\b/i);
  const player = match?.[1]?.trim() ?? '';
  return player.split(/\s+/).length >= 2 ? player : null;
}

export function parseSportKey(value: unknown): SportKey | null {
  const key = String(value ?? '').trim().toLowerCase();
  const aliases: Record<string, SportKey> = {
    mlb: 'mlb', baseball: 'mlb',
    nfl: 'nfl', football: 'nfl',
    nba: 'nba', basketball: 'nba',
    nhl: 'nhl', hockey: 'nhl',
  };
  return aliases[key] ?? null;
}
