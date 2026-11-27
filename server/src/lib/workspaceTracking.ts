import { loadLedgerPicks, type LedgerPick } from '../routes/ledger.js';
import type {
  ComparisonResults, Connector, TrackedEntry, TrackedSelection, TrackingSnapshot, TrackingSource,
} from '../workspace.js';
import { number, readConnector, record, string } from './workspaceConnector.js';

const HISTORY_LIMIT = 50;

function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('Expected a list');
  return value;
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function optionalNumber(value: unknown): number | null {
  if (value == null) return null;
  return number(value);
}

function americanOdds(value: unknown): number | null {
  const odds = optionalNumber(value);
  return odds !== null && Number.isInteger(odds) && Math.abs(odds) >= 100 ? odds : null;
}

function timestamp(value: unknown): string | null {
  const text = optionalText(value);
  if (!text?.includes('T')) return null;
  // BetIQ serializes UTC datetime fields without an offset.
  const utc = /(?:Z|[+-]\d\d:\d\d)$/i.test(text) ? text : `${text}Z`;
  const parsed = Date.parse(utc);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function normalizeStatus(value: unknown): string {
  const status = string(value).toLowerCase();
  switch (status) {
    case 'settled_win':
    case 'win':
      return 'won';
    case 'settled_loss':
    case 'loss':
      return 'lost';
    default:
      return status.replaceAll('_', ' ');
  }
}

function normalizeMarket(value: unknown): string | null {
  const market = optionalText(value)?.toLowerCase();
  switch (market) {
    case 'h2h':
    case 'moneyline':
      return 'moneyline';
    case 'spread':
    case 'spreads':
      return 'spread';
    case 'total':
    case 'totals':
      return 'total';
    default:
      return market ?? null;
  }
}

function sportsEdgeEntry(pick: LedgerPick): TrackedEntry {
  const odds = americanOdds(pick.odds);
  return {
    id: pick.id,
    kind: 'saved leg',
    title: pick.selection,
    status: pick.status,
    recordedAt: timestamp(pick.createdAt),
    recordType: 'saved',
    price: odds === null ? null : { value: odds, format: 'american' },
    selections: [{
      id: pick.id,
      name: pick.selection,
      eventId: optionalText(pick.eventId),
      event: optionalText(pick.game),
      eventDate: optionalText(pick.eventDate),
      market: normalizeMarket(pick.market),
      line: optionalNumber(pick.line),
      americanOdds: odds,
      status: pick.status,
    }],
  };
}

function betTrackSelection(value: unknown): TrackedSelection {
  const leg = record(value);
  const game = record(leg.game);
  const home = string(game.homeTeamName);
  const away = string(game.awayTeamName);
  const side = string(leg.selection);
  const name = side === 'home' ? home : side === 'away' ? away : side;
  return {
    id: string(leg.id),
    name,
    eventId: optionalText(game.externalId),
    event: `${away} at ${home}`,
    eventDate: timestamp(game.commenceTime)?.slice(0, 10) ?? null,
    market: normalizeMarket(leg.selectionType),
    line: optionalNumber(leg.teaserAdjustedLine ?? leg.userAdjustedLine ?? leg.line),
    americanOdds: americanOdds(leg.userAdjustedOdds ?? leg.odds),
    status: normalizeStatus(leg.status),
  };
}

function betTrackHistory(value: unknown): TrackingSource {
  const payload = record(value);
  if (payload.status !== 'success') throw new Error('BetTrack request failed');
  const data = record(payload.data);
  return {
    total: number(data.total),
    entries: list(data.bets).slice(0, HISTORY_LIMIT).map((value) => {
      const ticket = record(value);
      const odds = americanOdds(ticket.oddsAtPlacement);
      return {
        id: string(ticket.id),
        kind: 'ticket',
        title: optionalText(ticket.name) ?? 'BetTrack ticket',
        status: normalizeStatus(ticket.status),
        recordedAt: timestamp(ticket.placedAt),
        recordType: 'placed',
        price: odds === null ? null : { value: odds, format: 'american' },
        selections: list(ticket.legs).map(betTrackSelection),
      };
    }),
  };
}

function betIqHistory(value: unknown): TrackingSource {
  const tickets = list(value);
  return {
    total: tickets.length,
    entries: tickets.slice(0, HISTORY_LIMIT).map((value) => {
      const ticket = record(value);
      const odds = optionalNumber(ticket.combined_odds);
      return {
        id: string(ticket.id),
        kind: 'ticket',
        title: ticket.bet_type === 'straight' ? 'Straight pick' : `${number(ticket.legs)}-leg ticket`,
        status: normalizeStatus(ticket.status),
        recordedAt: timestamp(ticket.submitted_at),
        recordType: 'submitted',
        price: odds !== null && odds > 1 ? { value: odds, format: 'decimal' } : null,
        selections: list(ticket.legs_detail).map((value) => {
          const leg = record(value);
          return {
            id: String(number(leg.id)),
            name: string(leg.description),
            eventId: null,
            event: null,
            eventDate: optionalText(ticket.game_date),
            market: normalizeMarket(leg.market_type),
            line: optionalNumber(leg.point),
            americanOdds: americanOdds(leg.odds_american),
            status: leg.leg_result == null ? null : normalizeStatus(leg.leg_result),
          };
        }),
      };
    }),
  };
}

function comparisonResults(value: unknown): ComparisonResults {
  const stats = record(value);
  const settled = number(stats.n_settled);
  const wins = number(stats.wins);
  const losses = number(stats.losses);
  if (![settled, wins, losses].every((count) => Number.isInteger(count) && count >= 0) || wins + losses !== settled) {
    throw new Error('Inconsistent settlement counts');
  }
  return {
    settled, wins, losses,
    profit: settled ? optionalNumber(stats.total_pnl) : null,
    roi: settled ? optionalNumber(stats.roi_pct) : null,
    hitRate: settled ? optionalNumber(stats.wr_pct) : null,
  };
}

function betIqComparison(value: unknown) {
  const payload = record(value);
  const since = string(record(payload.period).since);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) throw new Error('Missing comparison period');
  return { since, user: comparisonResults(payload.user), model: comparisonResults(payload.model) };
}

function overlapKey(selection: TrackedSelection): string | null {
  const { eventId, market, line } = selection;
  // SportsEdge also stores ESPN and MLB IDs. Only consider the Odds API ID shape.
  if (!eventId || !/^[a-f0-9]{32}$/i.test(eventId)) return null;
  if (market !== 'moneyline' && market !== 'spread' && market !== 'total') return null;
  if (market !== 'moneyline' && line == null) return null;

  let name = selection.name.trim().toLowerCase().replace(/\s+/g, ' ');
  const suffix = /\s([+-]?\d+(?:\.\d+)?)$/.exec(name);
  if (market !== 'moneyline' && suffix && Number(suffix[1]) === line) {
    name = name.slice(0, suffix.index);
  }
  if (!name || name === 'home' || name === 'away') return null;

  return JSON.stringify([eventId.toLowerCase(), market, name, market === 'moneyline' ? null : line]);
}

function findOverlaps(sportsEdge: TrackedEntry[], betTrack: TrackedEntry[]): TrackingSnapshot['overlaps'] {
  const bySelection = new Map<string, string[]>();
  for (const entry of sportsEdge) {
    const key = overlapKey(entry.selections[0]);
    if (key) {
      const ids = bySelection.get(key) ?? [];
      ids.push(entry.id);
      bySelection.set(key, ids);
    }
  }
  return betTrack.flatMap((ticket) => ticket.selections.flatMap((selection) => {
    const key = overlapKey(selection);
    const ids = key ? bySelection.get(key) : undefined;
    // This is an overlap in selections. Distinct stakes or placement times can still be separate wagers.
    return ids?.length ? [{ ticketId: ticket.id, selectionId: selection.id, sportsEdgeIds: ids }] : [];
  }));
}

async function readSportsEdge(userId: string): Promise<Connector<TrackedEntry[]>> {
  try {
    const rows = (await loadLedgerPicks(userId)).map(sportsEdgeEntry);
    rows.sort((first, second) => (second.recordedAt ?? '').localeCompare(first.recordedAt ?? ''));
    return { status: 'ready', data: rows };
  } catch {
    return { status: 'unavailable' };
  }
}

export async function loadTrackingSnapshot(userId: string, days: '7' | '30' | '90'): Promise<TrackingSnapshot> {
  const { BETTRACK_URL, BETTRACK_API_KEY, BETIQ_URL } = process.env;
  const signal = AbortSignal.timeout(5000);
  const [sportsEdge, betTrack, betIq, comparison] = await Promise.all([
    readSportsEdge(userId),
    readConnector(BETTRACK_API_KEY ? BETTRACK_URL : undefined,
      `/api/mcp/bets?limit=${HISTORY_LIMIT}`, betTrackHistory, signal, BETTRACK_API_KEY),
    readConnector(BETIQ_URL, '/api/user-picks', betIqHistory, signal),
    readConnector(BETIQ_URL,
      `/api/ab-test/comparison?days=${days}&ingestion_filter=pregame_only&include_cashouts=false`,
      betIqComparison, signal),
  ]);

  return {
    sources: {
      SportsEdge: sportsEdge.status === 'ready'
        ? { status: 'ready', data: { total: sportsEdge.data.length, entries: sportsEdge.data.slice(0, HISTORY_LIMIT) } }
        : sportsEdge,
      BetTrack: betTrack,
      BetIQ: betIq,
    },
    comparison,
    overlaps: sportsEdge.status === 'ready' && betTrack.status === 'ready'
      ? findOverlaps(sportsEdge.data, betTrack.data.entries)
      : [],
  };
}
