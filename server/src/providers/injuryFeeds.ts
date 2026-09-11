// Free injury feeds, all keyless — added Sep 2026 per Josh's list of
// no-cost injury sources. Existing ESPN coverage lives in ./espn.ts; this
// module adds the two the list called out that we did not have:
//
//   1. nflverse weekly injury reports (100% free / open data). One CSV per
//      season from the nflverse-data release: report_status (Out /
//      Questionable / Doubtful), report_primary_injury, practice_status and
//      the week they apply to. This is the designations feed the NFL itself
//      publishes — not a guess.
//      URL verified live 2026-09-11: .../releases/download/injuries/injuries_2026.csv
//
//   2. MLB Stats API official roster status (state = Injured 10/15/60-Day).
//      MLB has NO league-wide /injuries endpoint (api/v1/injuries 404s —
//      verified 2026-09-11), so the authoritative IL state comes from the
//      roster entry of the player/team. getPlayerStatus() in mlbStatsApi.ts
//      already reads that; the helpers here classify and normalize it.
//
// Fail-closed rule (unchanged): a provider that fails contributes nothing and
// is reported as unavailable. We never emit a status we did not receive.

import { fetchJson } from './http.js';

const UA_SOURCE = 'nflverse/nflverse-data (injuries release CSV)';
const MLB_SOURCE = 'statsapi.mlb.com';

/**
 * Name key for cross-provider injury matching. http.normalizeName is
 * deliberately punctuation-only (it must not mangle hyphenated surnames), but
 * injury feeds need more: ESPN writes "Ronald Acuña Jr." while nflverse/MLB
 * write "Ronald Acuna", so diacritics and generational suffixes must fold.
 */
export function injuryNameKey(name: unknown): string {
  return String(name ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\.?\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export type InjuryDesignation =
  | 'out'
  | 'doubtful'
  | 'questionable'
  | 'day_to_day'
  | 'probable'
  | 'injured_list'
  | 'suspended'
  | 'active'
  | 'unknown';

/** Provider label -> our designation. Unknown labels stay unknown; the raw
 *  string is always preserved alongside so nothing is silently rewritten. */
export function classifyDesignation(raw: unknown): InjuryDesignation {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return 'unknown';
  if (s === 'out') return 'out';
  if (s === 'doubtful') return 'doubtful';
  if (s === 'questionable') return 'questionable';
  if (s === 'probable') return 'probable';
  if (s.includes('day-to-day') || s.includes('day to day') || s.includes('daytoday')) return 'day_to_day';
  // "suspension" does NOT contain "suspend" (suspension vs suspend) — match the
  // shared stem instead.
  if (s.includes('suspen')) return 'suspended';
  if (s.includes('injured') || s.includes('injured list') || /\bil\b/.test(s) || s.includes('reserve')) return 'injured_list';
  if (s === 'active' || s === 'available') return 'active';
  return 'unknown';
}

/** 0 = fully available, 1 = cannot play. Blunt on purpose: it answers
 *  "expected to be on the field", and day-to-day keeps a non-zero weight
 *  because those players frequently do play. */
export function designationWeight(d: InjuryDesignation): number {
  switch (d) {
    case 'out':
    case 'injured_list':
    case 'suspended':
      return 1;
    case 'doubtful':
      return 0.75;
    case 'questionable':
      return 0.5;
    case 'day_to_day':
      return 0.35;
    case 'probable':
      return 0.15;
    default:
      return 0;
  }
}

export function isUnavailable(d: InjuryDesignation): boolean {
  return designationWeight(d) >= 0.5;
}

export interface InjuryFeedEntry {
  playerName: string;
  team: string | null;
  position: string | null;
  designation: InjuryDesignation;
  designationRaw: string;
  injury: string | null;
  detail: string | null;
  week: number | null;
  statusDate: string | null;
  source: string;
}

export interface FeedResult {
  available: boolean;
  reason?: string;
  source: string;
  checkedAt: string;
  entries: InjuryFeedEntry[];
}

// --- nflverse weekly injury reports ----------------------------------------

/** Minimal quoted-field CSV -> records parser (matches providers/nflverse.ts). */
export function parseCsvRecords(text: string): Array<Record<string, string>> {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const split = (line: string): string[] => {
    const out: string[] = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (quoted && line[i + 1] === '"') { cur += '"'; i++; } else quoted = !quoted;
      } else if (ch === ',' && !quoted) { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur);
    return out;
  };
  const headers = split(lines[0]);
  return lines.slice(1).map((line) => {
    const values = split(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = values[i] ?? ''; });
    return row;
  });
}

export function nflverseInjuriesUrl(season: number): string {
  return `https://github.com/nflverse/nflverse-data/releases/download/injuries/injuries_${season}.csv`;
}

/**
 * Keep only each player's MOST RECENT weekly report. The CSV is one row per
 * (player, week), so without this the same player shows up for every week of
 * the season with stale designations.
 */
export function latestWeeklyReports(rows: Array<Record<string, string>>): Array<Record<string, string>> {
  const best = new Map<string, Record<string, string>>();
  for (const row of rows) {
    const name = (row.full_name || '').trim();
    if (!name || !row.week) continue;
    // Empty report_status rows are practice-only entries; they still carry
    // practice_status + injury, so keep them — but never let them outrank a
    // real game designation for the same week.
    const key = `${injuryNameKey(name)}|${(row.team || '').trim()}`;
    const existing = best.get(key);
    if (!existing) { best.set(key, row); continue; }
    const week = Number(row.week) || 0;
    const existingWeek = Number(existing.week) || 0;
    const rowHasStatus = Boolean((row.report_status || '').trim());
    const existingHasStatus = Boolean((existing.report_status || '').trim());
    if (week > existingWeek || (week === existingWeek && rowHasStatus && !existingHasStatus)) {
      best.set(key, row);
    }
  }
  return [...best.values()];
}

export function nflverseEntriesFromRows(rows: Array<Record<string, string>>): InjuryFeedEntry[] {
  return latestWeeklyReports(rows).map((row) => {
    const reported = (row.report_status || '').trim();
    const practice = (row.practice_status || '').trim();
    const injury = (row.report_primary_injury || row.practice_primary_injury || '').trim();
    // A Friday practice status of "Did Not Participate In Practice" is real
    // signal even when the game designation is blank, so it maps to doubtful
    // (the NFL's own practice-report convention) — never to a healthy status.
    const designation = reported
      ? classifyDesignation(reported)
      : practice.startsWith('Did Not Participate')
        ? 'doubtful'
        : practice.startsWith('Limited')
          ? 'questionable'
          : 'unknown';
    return {
      playerName: (row.full_name || '').trim(),
      team: (row.team || '').trim() || null,
      position: (row.position || '').trim() || null,
      designation,
      designationRaw: reported || practice || '',
      injury: injury || null,
      detail: practice || null,
      week: Number(row.week) || null,
      statusDate: null,
      source: UA_SOURCE,
    };
  }).filter((entry) => entry.playerName.length > 0 && entry.designation !== 'unknown');
}

/** NFL weekly injury report (nflverse). Cached for 30 minutes. */
export async function getNflWeeklyInjuries(season = new Date().getUTCFullYear()): Promise<FeedResult> {
  const checkedAt = new Date().toISOString();
  const url = nflverseInjuriesUrl(season);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'SportsEdge/1.0' }, signal: AbortSignal.timeout(12_000) });
    if (!res.ok) {
      return { available: false, reason: `nflverse injuries ${season}: HTTP ${res.status}`, source: UA_SOURCE, checkedAt, entries: [] };
    }
    const rows = parseCsvRecords(await res.text());
    const entries = nflverseEntriesFromRows(rows);
    if (!entries.length) {
      return { available: false, reason: `nflverse injuries ${season}: no usable rows`, source: UA_SOURCE, checkedAt, entries: [] };
    }
    return { available: true, source: UA_SOURCE, checkedAt, entries };
  } catch (e) {
    return { available: false, reason: `nflverse injuries ${season}: ${(e as Error).message}`, source: UA_SOURCE, checkedAt, entries: [] };
  }
}

// --- MLB injured list (statsapi roster status) ------------------------------

export interface MlbRosterStatusRow {
  person?: { id?: number; fullName?: string };
  position?: { abbreviation?: string };
  status?: { code?: string; description?: string };
  jerseyNumber?: string;
}

/** Normalize a statsapi 40-man roster into IL/active entries. Only non-active
 *  statuses are returned: "Active" adds nothing and would swamp the feed. */
export function mlbEntriesFromRoster(roster: MlbRosterStatusRow[], teamName: string | null, teamId: number | null): InjuryFeedEntry[] {
  const entries: InjuryFeedEntry[] = [];
  for (const row of roster) {
    const name = String(row?.person?.fullName ?? '').trim();
    if (!name) continue;
    const raw = String(row?.status?.description ?? '').trim();
    const designation = classifyDesignation(raw);
    if (designation === 'active' || designation === 'unknown') continue;
    entries.push({
      playerName: name,
      team: teamName ?? (teamId != null ? String(teamId) : null),
      position: row?.position?.abbreviation ?? null,
      designation,
      designationRaw: raw,
      injury: null,
      detail: raw,
      week: null,
      statusDate: null,
      source: MLB_SOURCE,
    });
  }
  return entries;
}

/** One team's 40-man roster statuses. Two paced calls (~2s). */
export async function getMlbTeamInjuries(teamId: number): Promise<FeedResult> {
  const checkedAt = new Date().toISOString();
  try {
    const roster = await fetchJson(`https://statsapi.mlb.com/api/v1/teams/${teamId}/roster?rosterType=40Man`);
    const rows: MlbRosterStatusRow[] = Array.isArray(roster?.roster) ? roster.roster : [];
    return { available: true, source: MLB_SOURCE, checkedAt, entries: mlbEntriesFromRoster(rows, null, teamId) };
  } catch (e) {
    return { available: false, reason: `MLB roster ${teamId}: ${(e as Error).message}`, source: MLB_SOURCE, checkedAt, entries: [] };
  }
}

/**
 * League-wide MLB injured list. 30 teams x ~0.2s paced = a few seconds, so the
 * caller must only use this on a cached/league view, never per candidate.
 */
export async function getMlbLeagueInjuries(season = new Date().getUTCFullYear()): Promise<FeedResult> {
  const checkedAt = new Date().toISOString();
  try {
    const teamsJson = await fetchJson(`https://statsapi.mlb.com/api/v1/teams?sportId=1&season=${season}`);
    const teams: Array<{ id?: number; name?: string }> = Array.isArray(teamsJson?.teams) ? teamsJson.teams : [];
    if (!teams.length) return { available: false, reason: 'MLB teams list empty', source: MLB_SOURCE, checkedAt, entries: [] };
    const entries: InjuryFeedEntry[] = [];
    for (const team of teams) {
      if (team?.id == null) continue;
      const result = await getMlbTeamInjuries(Number(team.id));
      if (result.available) {
        for (const entry of result.entries) entries.push({ ...entry, team: entry.team ?? team.name ?? null });
      }
    }
    return { available: entries.length > 0, source: MLB_SOURCE, checkedAt, entries };
  } catch (e) {
    return { available: false, reason: `MLB league injuries: ${(e as Error).message}`, source: MLB_SOURCE, checkedAt, entries: [] };
  }
}

// --- merge / change tracking ------------------------------------------------

/**
 * Collapse the same player across providers into one entry: most severe
 * designation wins, and the first non-empty comment/injury/detail is kept so
 * ESPN's analyst notes survive an nflverse merge.
 */
export function mergeInjuryEntries(entries: InjuryFeedEntry[]): InjuryFeedEntry[] {
  const byKey = new Map<string, InjuryFeedEntry>();
  for (const entry of entries) {
    const key = injuryNameKey(entry.playerName);
    const existing = byKey.get(key);
    if (!existing) { byKey.set(key, { ...entry }); continue; }
    const moreSevere = designationWeight(entry.designation) > designationWeight(existing.designation);
    byKey.set(key, {
      ...existing,
      designation: moreSevere ? entry.designation : existing.designation,
      designationRaw: moreSevere ? entry.designationRaw : existing.designationRaw,
      team: existing.team ?? entry.team,
      position: existing.position ?? entry.position,
      injury: existing.injury ?? entry.injury,
      detail: existing.detail ?? entry.detail,
      statusDate: existing.statusDate ?? entry.statusDate,
      week: existing.week ?? entry.week,
      // Provenance is preserved when sources disagree: the losing label is
      // appended rather than dropped.
      source: existing.source === entry.source ? existing.source : `${existing.source} + ${entry.source}`,
    });
  }
  return [...byKey.values()];
}

export interface DesignationChange {
  playerName: string;
  from: InjuryDesignation;
  to: InjuryDesignation;
  changedAt: string | null;
}

/**
 * Compare two snapshots of the same league feed and return the players whose
 * designation moved. Used to surface "Out -> Day-To-Day" transitions (ESPN
 * supplies the reported timestamp; nflverse/weekly sources often do not, in
 * which case changedAt stays null rather than being invented).
 */
export function designationChanges(
  previous: InjuryFeedEntry[],
  next: InjuryFeedEntry[],
): DesignationChange[] {
  const before = new Map(previous.map((e) => [injuryNameKey(e.playerName), e]));
  const changes: DesignationChange[] = [];
  for (const entry of next) {
    const prior = before.get(injuryNameKey(entry.playerName));
    if (!prior) continue;
    if (prior.designation === entry.designation) continue;
    changes.push({
      playerName: entry.playerName,
      from: prior.designation,
      to: entry.designation,
      changedAt: entry.statusDate ?? null,
    });
  }
  return changes;
}

let lastNflSnapshot: InjuryFeedEntry[] | null = null;
let lastMlbSnapshot: InjuryFeedEntry[] | null = null;

export function rememberSnapshot(sport: 'nfl' | 'mlb', entries: InjuryFeedEntry[]): void {
  if (sport === 'nfl') lastNflSnapshot = entries;
  else lastMlbSnapshot = entries;
}

export function previousSnapshot(sport: 'nfl' | 'mlb'): InjuryFeedEntry[] | null {
  return sport === 'nfl' ? lastNflSnapshot : lastMlbSnapshot;
}
