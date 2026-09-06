import * as espn from './espn.js';
import * as mlb from './mlbStatsApi.js';
import * as sharp from './sharpApi.js';
import * as sgo from './sportsGameOdds.js';
import { normalizeMarket } from '../models/playerPropModel.js';

const ESPN_BASE = 'https://site.web.api.espn.com/apis/site/v2/sports';

export interface SlateEvent {
  sport: 'mlb' | 'nba' | 'nfl' | 'nhl';
  eventId: string | number;
  date: string;
  away: { id: string | null; name: string };
  home: { id: string | null; name: string };
  venue: string | null;
  status: string | null;
  awayProbable?: string | null;
  homeProbable?: string | null;
}

export interface DiscoveredPlayer {
  id: string | number | null;
  name: string;
  teamId: string | null;
  team: string;
  position: string | null;
  eventId: string | number;
  eventDate: string;
  opponent: string;
  homeAway: 'home' | 'away';
  lineupSlot: number | null;
  probablePitcher: boolean;
  source: string;
}

const ESPN_MAP: Record<'nba' | 'nfl' | 'nhl', espn.EspnSport> = {
  nba: 'basketball/nba', nfl: 'football/nfl', nhl: 'hockey/nhl',
};

function isoDate(value: unknown): string {
  const parsed = new Date(String(value ?? ''));
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
}

async function fetchJson(url: string): Promise<any> {
  const response = await fetch(url, { headers: { 'User-Agent': 'SportsEdge/0.2 data-discovery' }, signal: AbortSignal.timeout(6500) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function flattenRoster(athletes: any[]): Array<{ id: string; name: string; position: string | null; status: string | null }> {
  const out: Array<{ id: string; name: string; position: string | null; status: string | null }> = [];
  for (const group of athletes ?? []) {
    const rows = Array.isArray(group?.items) ? group.items : [group];
    for (const player of rows) {
      if (!player?.id) continue;
      out.push({
        id: String(player.id),
        name: String(player.displayName ?? player.fullName ?? '').trim(),
        position: player.position?.abbreviation ?? player.position?.displayName ?? group?.position ?? null,
        status: player.status?.type ?? player.status?.name ?? null,
      });
    }
  }
  return out.filter((row) => row.name);
}

export async function discoverSlateEvents(
  sport: 'mlb' | 'nba' | 'nfl' | 'nhl',
  date: string,
): Promise<SlateEvent[]> {
  if (sport === 'mlb') {
    const result = await mlb.getSchedule(date, date);
    if (!result.available || !result.data) return [];
    return result.data.map((game) => ({
      sport,
      eventId: game.gamePk,
      date: game.officialDate,
      away: { id: null, name: game.away.name },
      home: { id: null, name: game.home.name },
      venue: game.venue ?? null,
      status: game.status ?? null,
      awayProbable: game.awayProbable ?? null,
      homeProbable: game.homeProbable ?? null,
    }));
  }

  const espnSport = ESPN_MAP[sport];
  const day = date.replace(/-/g, '');
  const payload = await fetchJson(`${ESPN_BASE}/${espnSport}/scoreboard?dates=${day}`);
  const events: any[] = Array.isArray(payload?.events) ? payload.events : [];
  return events.map((event) => {
    const competitors: any[] = event?.competitions?.[0]?.competitors ?? [];
    const away = competitors.find((row) => row?.homeAway === 'away') ?? competitors[0] ?? {};
    const home = competitors.find((row) => row?.homeAway === 'home') ?? competitors[1] ?? {};
    return {
      sport,
      eventId: String(event?.id ?? ''),
      date: isoDate(event?.date) || date,
      away: { id: away?.team?.id != null ? String(away.team.id) : null, name: String(away?.team?.displayName ?? away?.team?.name ?? '') },
      home: { id: home?.team?.id != null ? String(home.team.id) : null, name: String(home?.team?.displayName ?? home?.team?.name ?? '') },
      venue: event?.competitions?.[0]?.venue?.fullName ?? null,
      status: event?.status?.type?.name ?? event?.status?.type?.description ?? null,
    };
  }).filter((event) => event.eventId && event.away.name && event.home.name);
}

async function espnTeamIdByName(sport: espn.EspnSport, teamName: string): Promise<string | null> {
  const normalized = teamName.toLowerCase();
  const teams = await espn.getTeams(sport);
  const hit = teams.find((team) => team.name.toLowerCase() === normalized)
    ?? teams.find((team) => normalized.includes(team.name.toLowerCase()) || team.name.toLowerCase().includes(normalized));
  return hit?.id ?? null;
}

async function espnRoster(sport: espn.EspnSport, teamId: string): Promise<ReturnType<typeof flattenRoster>> {
  let payload: any;
  try {
    payload = await fetchJson(`${ESPN_BASE}/${sport}/teams/${teamId}/roster`);
  } catch (e) {
    // Degrade per team: an ESPN hiccup must not void the whole side's candidates
    console.warn(`[slateDiscovery] ESPN roster fetch failed for ${sport} team ${teamId}: ${(e as Error).message}`);
    return [];
  }
  return flattenRoster(payload?.athletes ?? []);
}

function positionAllowed(sport: 'mlb' | 'nba' | 'nfl' | 'nhl', position: string | null): boolean {
  const pos = String(position ?? '').toUpperCase();
  if (sport === 'mlb') return !['P', 'SP', 'RP'].includes(pos);
  if (sport === 'nfl') return ['QB', 'RB', 'FB', 'WR', 'TE'].includes(pos);
  if (sport === 'nhl') return !['D'].includes(pos); // forwards + goalies; market filter handles role
  return true;
}

export async function discoverPlayersForEvent(event: SlateEvent, exclude: Set<string> = new Set()): Promise<DiscoveredPlayer[]> {
  if (event.sport === 'mlb') {
    const output: DiscoveredPlayer[] = [];
    // Lineup fetch is one request, but a single failure here used to bubble out
    // of the whole discovery call and zero out the slate for this event.
    let lineups: Awaited<ReturnType<typeof mlb.getLineups>> | null = null;
    try {
      lineups = await mlb.getLineups(Number(event.eventId));
    } catch (e) {
      console.warn(`[slateDiscovery] lineups unavailable for game ${event.eventId}: ${(e as Error).message}`);
    }
    if (lineups?.available && lineups.data) {
      const data = lineups.data;
      const sides = [
        { side: 'away' as const, team: event.away.name, opponent: event.home.name, data: data.away },
        { side: 'home' as const, team: event.home.name, opponent: event.away.name, data: data.home },
      ];
      for (const row of sides) {
        (Array.isArray(row.data?.battingOrder) ? row.data.battingOrder : []).forEach((player: any, index: number) => {
          if (!player?.fullName) return;
          if (exclude.has(String(player.fullName).toLowerCase())) return;
          output.push({
          id: player.id ?? null,
          name: player.fullName,
          teamId: null,
          team: row.team,
          position: null,
          eventId: event.eventId,
          eventDate: event.date,
          opponent: row.opponent,
          homeAway: row.side,
          lineupSlot: index + 1,
          probablePitcher: false,
          source: 'statsapi.mlb.com boxscore',
          });
        });
      }
    }

    // Before batting orders post, use current ESPN MLB rosters only for candidate
    // discovery. The normal SportsEdge availability gate still decides whether a
    // candidate can become final or must remain provisional.
    if (!output.some((row) => !row.probablePitcher)) {
      for (const side of ['away', 'home'] as const) {
        const team = event[side];
        const opponent = event[side === 'away' ? 'home' : 'away'];
        let teamId: string | null = null;
        try {
          teamId = await espnTeamIdByName('baseball/mlb', team.name);
        } catch (e) {
          // espnTeamIdByName hits ESPN /teams; a failure must not abort the slate
          console.warn(`[slateDiscovery] ESPN team lookup failed for ${team.name}: ${(e as Error).message}`);
          continue;
        }
        if (!teamId) continue;
        try {
          const roster = (await espnRoster('baseball/mlb', teamId)).filter((player) => positionAllowed('mlb', player.position));
          for (const player of roster.slice(0, 16)) {
            if (exclude.has(String(player.name ?? '').toLowerCase())) continue;
          output.push({
            id: player.id,
            name: player.name,
            teamId,
            team: team.name,
            position: player.position,
            eventId: event.eventId,
            eventDate: event.date,
            opponent: opponent.name,
            homeAway: side,
            lineupSlot: null,
            probablePitcher: false,
            source: 'site.web.api.espn.com roster',
          });
          }
        } catch { /* other teams still remain usable */ }
      }
    }

    for (const [side, name] of [['away', event.awayProbable], ['home', event.homeProbable]] as const) {
      if (!name) continue;
      if (exclude.has(String(name ?? '').toLowerCase())) continue;
      output.push({
        id: null,
        name,
        teamId: null,
        team: event[side].name,
        position: 'P',
        eventId: event.eventId,
        eventDate: event.date,
        opponent: event[side === 'away' ? 'home' : 'away'].name,
        homeAway: side,
        lineupSlot: null,
        probablePitcher: true,
        source: 'statsapi.mlb.com schedule',
      });
    }
    return output;
  }

  const sport = ESPN_MAP[event.sport];
  const output: DiscoveredPlayer[] = [];
  for (const side of ['away', 'home'] as const) {
    const team = event[side];
    const opponent = event[side === 'away' ? 'home' : 'away'];
    if (!team.id) continue;
    try {
      const roster = (await espnRoster(sport, team.id)).filter((player) => positionAllowed(event.sport, player.position));
      const perTeam = event.sport === 'nfl' ? 9 : event.sport === 'nhl' ? 10 : 9;
      for (const player of roster.slice(0, perTeam)) output.push({
        id: player.id,
        name: player.name,
        teamId: team.id,
        team: team.name,
        position: player.position,
        eventId: event.eventId,
        eventDate: event.date,
        opponent: opponent.name,
        homeAway: side,
        lineupSlot: null,
        probablePitcher: false,
        source: 'site.web.api.espn.com roster',
      });
    } catch { /* degrade per team */ }
  }
  return output;
}

export interface SharpPrice {
  player: string;
  market: string;
  line: number;
  over: number | null;
  under: number | null;
  book: string;
  books?: string[];
  bookCount?: number;
  lineType?: 'primary' | 'alternate';
  isAlternate?: boolean;
  consensusRank?: number;
  source?: string;
  lineLabel?: string;
}

export interface SlatePriceResult {
  available: boolean;
  reason?: string;
  byKey: Map<string, SharpPrice>;
  alternatesByKey: Map<string, SharpPrice[]>;
}

/**
 * Real SharpApi player-prop prices for a slate, keyed by normalized
 * `player|market`. Used to attach a real sportsbook line/odds to a screen
 * candidate when the model's derived line is only a proposal. Degrades to
 * `{available:false}` on any failure — never fabricates a price.
 */
export async function getSharpSlatePrices(
  sport: 'mlb' | 'nba' | 'nfl' | 'nhl',
  matchup?: { home: string; away: string },
): Promise<SlatePriceResult> {
  try {
    const result = await sharp.getSharpGameOdds(matchup?.away, matchup?.home, sport);
    if (!result.available || !Array.isArray(result.props?.markets)) {
      return { available: false, reason: result.reason ?? 'SharpApi no live props', byKey: new Map(), alternatesByKey: new Map() };
    }
    const grouped = new Map<string, SharpPrice[]>();
    for (const marketRow of result.props.markets as any[]) {
      if (!marketRow?.player || marketRow.line == null) continue;
      const market = normalizeMarket(String(marketRow.market ?? '')).toLowerCase();
      const key = String(marketRow.player).toLowerCase() + '|' + market;
      const price: SharpPrice = {
        player: marketRow.player, market, line: Number(marketRow.line),
        over: marketRow.over ?? null, under: marketRow.under ?? null,
        book: marketRow.book ?? 'sharpapi', books: marketRow.books ?? [marketRow.book ?? 'sharpapi'],
        bookCount: Number(marketRow.bookCount ?? (marketRow.books?.length ?? 1)),
        lineType: marketRow.lineType === 'alternate' ? 'alternate' : 'primary',
        isAlternate: Boolean(marketRow.isAlternate), consensusRank: Number(marketRow.consensusRank ?? 1),
        source: 'api.sharpapi.io',
        lineLabel: marketRow.lineType === 'alternate' ? 'ALTERNATE LINE' : 'PRIMARY MARKET LINE',
      };
      grouped.set(key, [...(grouped.get(key) ?? []), price]);
    }
    const byKey = new Map<string, SharpPrice>();
    const alternatesByKey = new Map<string, SharpPrice[]>();
    for (const [key, offers] of grouped) {
      const sorted = [...offers].sort((a, b) =>
        Number(a.isAlternate) - Number(b.isAlternate)
        || (b.bookCount ?? 0) - (a.bookCount ?? 0)
        || Number(b.over != null && b.under != null) - Number(a.over != null && a.under != null)
      );
      if (sorted[0]) byKey.set(key, { ...sorted[0], lineType: 'primary', isAlternate: false, consensusRank: 1 });
      if (sorted.length > 1) alternatesByKey.set(key, sorted.slice(1).map((row, index) => ({ ...row, lineType: 'alternate', isAlternate: true, consensusRank: index + 2, lineLabel: 'ALTERNATE LINE' })));
    }
    return { available: byKey.size > 0, reason: byKey.size ? undefined : 'SharpApi no priced props', byKey, alternatesByKey };
  } catch (error) {
    return { available: false, reason: 'SharpApi price lookup failed: ' + (error as Error).message, byKey: new Map(), alternatesByKey: new Map() };
  }
}

/** Prefer SportsGameOdds' consensus bookOverUnder line, then SharpAPI primary.
 * Alternate lines remain attached for display/research but never displace the
 * primary line merely because they were returned later by a provider. */
export async function getConsensusSlatePrices(
  sport: 'mlb' | 'nba' | 'nfl' | 'nhl',
): Promise<SlatePriceResult> {
  try {
    const result = await sgo.getSgoSlateEvents(sport, 12);
    if (result.available && Array.isArray(result.events)) {
      const grouped = new Map<string, Map<number, SharpPrice>>();
      for (const event of result.events) {
        for (const prop of event.props ?? []) {
          if (!prop?.playerName || prop.line == null || !Number.isFinite(Number(prop.line))) continue;
          const market = normalizeMarket(String(prop.market ?? '')).toLowerCase();
          const key = String(prop.playerName).toLowerCase() + '|' + market;
          const line = Number(prop.line);
          const lineMap = grouped.get(key) ?? new Map<number, SharpPrice>();
          const current = lineMap.get(line) ?? {
            player: prop.playerName, market, line, over: null, under: null,
            book: 'SportsGameOdds consensus', books: [], bookCount: 0, source: 'api.sportsgameodds.com',
            lineType: 'primary', isAlternate: false, consensusRank: 1, lineLabel: 'PRIMARY / CONSENSUS LINE',
          };
          if (prop.side === 'over') current.over = prop.odds ?? current.over;
          if (prop.side === 'under') current.under = prop.odds ?? current.under;
          const bookNames = Object.keys(prop.byBookmaker ?? {});
          current.books = [...new Set([...(current.books ?? []), ...bookNames])];
          current.bookCount = Math.max(current.bookCount ?? 0, current.books.length);
          lineMap.set(line, current); grouped.set(key, lineMap);
        }
      }
      const byKey = new Map<string, SharpPrice>();
      const alternatesByKey = new Map<string, SharpPrice[]>();
      for (const [key, lineMap] of grouped) {
        const offers = [...lineMap.values()].sort((a, b) =>
          (b.bookCount ?? 0) - (a.bookCount ?? 0)
          || Number(b.over != null && b.under != null) - Number(a.over != null && a.under != null)
        );
        const primary = offers[0];
        if (!primary) continue;
        byKey.set(key, { ...primary, lineType: 'primary', isAlternate: false, consensusRank: 1, lineLabel: 'PRIMARY / CONSENSUS LINE' });
        if (offers.length > 1) alternatesByKey.set(key, offers.slice(1).map((row, index) => ({ ...row, lineType: 'alternate', isAlternate: true, consensusRank: index + 2, lineLabel: 'ALTERNATE LINE' })));
      }
      if (byKey.size) return { available: true, byKey, alternatesByKey };
    }
  } catch (error) {
    console.warn('[slateDiscovery] SGO consensus props unavailable: ' + (error as Error).message);
  }
  return getSharpSlatePrices(sport);
},
): Promise<{ available: boolean; reason?: string; byKey: Map<string, SharpPrice> }> {
  try {
    const result = await sharp.getSharpGameOdds(matchup?.away, matchup?.home, sport);
    if (!result.available || !Array.isArray(result.props?.markets)) {
      return { available: false, reason: result.reason ?? 'SharpApi no live props', byKey: new Map() };
    }
    const byKey = new Map<string, SharpPrice>();
    for (const m of result.props.markets as any[]) {
      if (!m?.player || m.line == null) continue;
      // Canonicalize BOTH sides of the lookup key through normalizeMarket:
      // SharpApi emits labels like "Total Bases" while the screener looks up
      // model markets like "totalBases"; the old raw-lowercase key silently
      // mismatched every multi-word market (totalBases, homeRuns, shotsOnGoal…).
      const market = normalizeMarket(String(m.market ?? '')).toLowerCase();
      const key = `${String(m.player).toLowerCase()}|${market}`;
      byKey.set(key, {
        player: m.player,
        market: market,
        line: Number(m.line),
        over: m.over ?? null,
        under: m.under ?? null,
        book: m.book ?? 'sharpapi',
      });
    }
    return { available: byKey.size > 0, reason: byKey.size ? undefined : 'SharpApi no priced props', byKey };
  } catch (error) {
    return { available: false, reason: `SharpApi price lookup failed: ${(error as Error).message}`, byKey: new Map() };
  }
}
