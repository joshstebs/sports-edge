// Unified injury report — one shape over every free injury source.
//
// Sources composed here:
//   * ESPN public injury report (keyless) — all four sports. Already in
//     ./espn.ts; supplies designation, short/long analyst comment, body part
//     and the provider-reported status-change timestamp.
//   * nflverse weekly injury reports (keyless, open data) — NFL only. Adds the
//     league's own game designation + practice participation for the current
//     week, which ESPN's injury feed does not carry.
//   * MLB Stats API roster status (keyless) — MLB only, authoritative IL
//     (Injured 10/15/60-Day) state with the status date, for a named player.
//
// Rules: every entry carries its source; a failed provider is reported in
// `unavailable` and contributes nothing; a player is never given a status we
// did not receive.

import * as espn from './espn.js';
import * as mlb from './mlbStatsApi.js';
import * as feeds from './injuryFeeds.js';

export type InjurySport = 'mlb' | 'nfl' | 'nba' | 'nhl';

const ESPN_MAP: Record<InjurySport, espn.EspnSport> = {
  mlb: 'baseball/mlb',
  nfl: 'football/nfl',
  nba: 'basketball/nba',
  nhl: 'hockey/nhl',
};

export interface InjuryReportEntry {
  playerName: string;
  team: string | null;
  position: string | null;
  designation: feeds.InjuryDesignation;
  designationRaw: string;
  unavailable: boolean;
  injury: string | null;
  detail: string | null;
  shortComment: string | null;
  longComment: string | null;
  changedAt: string | null;
  week: number | null;
  source: string;
}

export interface RosterStatus {
  player: string;
  available: boolean;
  reason?: string;
  playerId: number | null;
  statusCode: string | null;
  status: string | null;
  isActive: boolean | null;
  statusDate: string | null;
  source: string;
}

export interface InjuryReport {
  available: boolean;
  sport: InjurySport;
  checkedAt: string;
  playerFilter: string | null;
  sources: string[];
  unavailable: Array<{ source: string; reason: string }>;
  count: number;
  byDesignation: Record<string, number>;
  changes: feeds.DesignationChange[];
  rosterStatus?: RosterStatus;
  entries: InjuryReportEntry[];
  reason?: string;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; value: InjuryReport }>();

function espnEntryToReport(entry: espn.EspnInjury): InjuryReportEntry {
  const designation = feeds.classifyDesignation(entry.status);
  return {
    playerName: entry.playerName,
    team: entry.teamName,
    position: null,
    designation,
    designationRaw: entry.status,
    unavailable: feeds.isUnavailable(designation),
    injury: entry.type,
    detail: entry.detail,
    shortComment: entry.shortComment,
    longComment: entry.longComment,
    changedAt: entry.date,
    week: null,
    source: 'site.web.api.espn.com',
  };
}

function feedEntryToReport(entry: feeds.InjuryFeedEntry): InjuryReportEntry {
  return {
    playerName: entry.playerName,
    team: entry.team,
    position: entry.position,
    designation: entry.designation,
    designationRaw: entry.designationRaw,
    unavailable: feeds.isUnavailable(entry.designation),
    injury: entry.injury,
    detail: entry.detail,
    shortComment: null,
    longComment: null,
    changedAt: entry.statusDate,
    week: entry.week,
    source: entry.source,
  };
}

/** Exported for tests: fold every source's entries into one deduped list. */
export function buildReportEntries(
  espnEntries: espn.EspnInjury[],
  feedEntries: feeds.InjuryFeedEntry[],
): InjuryReportEntry[] {
  const espnAsFeed: feeds.InjuryFeedEntry[] = espnEntries.map((e) => ({
    playerName: e.playerName,
    team: e.teamName,
    position: null,
    designation: feeds.classifyDesignation(e.status),
    designationRaw: e.status,
    injury: e.type,
    detail: e.detail,
    week: null,
    statusDate: e.date,
    source: 'site.web.api.espn.com',
  }));
  // ESPN is passed first so its analyst comments/date win the merge, while a
  // more severe designation from any provider still takes precedence.
  const merged = feeds.mergeInjuryEntries([...espnAsFeed, ...feedEntries]);
  const byName = new Map(espnEntries.map((e) => [feeds.injuryNameKey(e.playerName), e]));
  const feedByName = new Map(feedEntries.map((e) => [feeds.injuryNameKey(e.playerName), e]));
  return merged.map((entry) => {
    const espnMatch = byName.get(feeds.injuryNameKey(entry.playerName));
    const feedMatch = feedByName.get(feeds.injuryNameKey(entry.playerName));
    const base = espnMatch
      ? espnEntryToReport(espnMatch)
      : feedMatch
        ? feedEntryToReport(feedMatch)
        : feedEntryToReport(entry);
    // Keep whatever the merge promoted (severity / provenance) on top of the
    // richer comment-bearing record.
    return {
      ...base,
      designation: entry.designation,
      designationRaw: entry.designationRaw,
      unavailable: feeds.isUnavailable(entry.designation),
      injury: base.injury ?? entry.injury,
      detail: base.detail ?? entry.detail,
      source: entry.source,
      team: entry.team ?? base.team,
      position: entry.position ?? base.position,
      changedAt: base.changedAt ?? entry.statusDate ?? null,
    };
  });
}

function countByDesignation(entries: InjuryReportEntry[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const entry of entries) out[entry.designation] = (out[entry.designation] ?? 0) + 1;
  return out;
}

async function mlbRosterStatus(playerName: string): Promise<RosterStatus> {
  const source = 'statsapi.mlb.com';
  const found = await mlb.searchPlayer(playerName);
  if (!found.available || !found.data) {
    return { player: playerName, available: false, reason: found.reason ?? 'player not found', playerId: null, statusCode: null, status: null, isActive: null, statusDate: null, source };
  }
  const status = await mlb.getPlayerStatus(found.data.id);
  if (!status.available || !status.data) {
    return { player: found.data.fullName, available: false, reason: status.reason ?? 'roster status unavailable', playerId: found.data.id, statusCode: null, status: null, isActive: null, statusDate: null, source };
  }
  return {
    player: status.data.fullName,
    available: true,
    playerId: status.data.id,
    statusCode: status.data.rosterStatusCode,
    status: status.data.rosterStatus,
    isActive: status.data.isActive,
    statusDate: status.data.statusDate,
    source,
  };
}

/**
 * Compose the injury report for a sport. `playerName` narrows the result and,
 * for MLB, additionally pulls the official roster/IL status for that player.
 */
export async function getInjuryReport(sport: InjurySport, playerName?: string): Promise<InjuryReport> {
  const player = String(playerName ?? '').trim();
  const cacheKey = `${sport}:${player.toLowerCase()}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const checkedAt = new Date().toISOString();
  const sources: string[] = [];
  const unavailable: Array<{ source: string; reason: string }> = [];
  const espnRaw: espn.EspnInjury[] = [];
  const feedEntries: feeds.InjuryFeedEntry[] = [];
  let rosterStatus: RosterStatus | undefined;
  let sourceChanges: feeds.DesignationChange[] = [];

  const espnReport = await espn.getLeagueInjuries(ESPN_MAP[sport]);
  if (espnReport.available) {
    sources.push(espnReport.source);
    espnRaw.push(...espnReport.injuries);
  } else {
    unavailable.push({ source: espnReport.source, reason: espnReport.reason ?? 'ESPN injury report unavailable' });
  }

  if (sport === 'nfl') {
    const weekly = await feeds.getNflWeeklyInjuries();
    if (weekly.available) {
      sources.push(weekly.source);
      // Snapshot diffing gives real "Out -> Day-To-Day" transitions; the first
      // observation of a player simply has no prior state to compare.
      const previous = feeds.previousSnapshot('nfl');
      feeds.rememberSnapshot('nfl', weekly.entries);
      feedEntries.push(...weekly.entries);
      if (previous) sourceChanges = feeds.designationChanges(previous, weekly.entries);
    } else {
      unavailable.push({ source: weekly.source, reason: weekly.reason ?? 'nflverse injuries unavailable' });
    }
  }

  if (sport === 'mlb' && player) {
    rosterStatus = await mlbRosterStatus(player);
    if (rosterStatus.available && rosterStatus.status) {
      sources.push('statsapi.mlb.com (roster)');
      const designation = feeds.classifyDesignation(rosterStatus.status);
      if (designation !== 'active' && designation !== 'unknown') {
        feedEntries.push({
          playerName: rosterStatus.player,
          team: null,
          position: null,
          designation,
          designationRaw: rosterStatus.status,
          injury: null,
          detail: rosterStatus.status,
          week: null,
          statusDate: rosterStatus.statusDate,
          source: 'statsapi.mlb.com',
        });
      }
    } else if (!rosterStatus.available) {
      unavailable.push({ source: 'statsapi.mlb.com (roster)', reason: rosterStatus.reason ?? 'roster status unavailable' });
    }
  }

  let entries = buildReportEntries(espnRaw, feedEntries);
  if (player) {
    const target = feeds.injuryNameKey(player);
    const exact = entries.filter((e) => feeds.injuryNameKey(e.playerName) === target);
    const partial = entries.filter((e) => feeds.injuryNameKey(e.playerName).includes(target));
    entries = exact.length ? exact : partial;
  } else {
    // League view: ESPN lists every healthy player as "Active", which would
    // swamp the feed. Keep it out of the list, but keep it for a named player
    // so "is he actually available" stays answerable.
    entries = entries.filter((e) => e.designation !== 'active');
  }

  if (!espnReport.available && entries.length === 0) {
    const result: InjuryReport = {
      available: false,
      sport,
      checkedAt,
      playerFilter: player || null,
      sources,
      unavailable,
      count: 0,
      byDesignation: {},
      changes: [],
      rosterStatus,
      entries: [],
      reason: unavailable[0]?.reason ?? 'no injury source available',
    };
    cache.set(cacheKey, { at: Date.now(), value: result });
    return result;
  }

  const result: InjuryReport = {
    available: true,
    sport,
    checkedAt,
    playerFilter: player || null,
    sources,
    unavailable,
    count: entries.length,
    byDesignation: countByDesignation(entries),
    changes: sourceChanges,
    rosterStatus,
    entries,
  };
  cache.set(cacheKey, { at: Date.now(), value: result });
  return result;
}
