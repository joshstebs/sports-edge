import type { ToolDef, ToolOutcome } from './tools.js';
import * as sgo from '../providers/sportsGameOdds.js';
import * as espnOdds from '../providers/espnOdds.js';
import { discoverSlateEvents } from '../providers/slateDiscovery.js';

type Sport = 'mlb' | 'nfl' | 'nba' | 'nhl';

function ok(summary: string, payload: any): ToolOutcome {
  return { available: true, summary, data: payload, payload };
}
function unavailable(reason: string): ToolOutcome {
  return { available: false, reason, summary: 'unavailable: ' + reason, data: { available: false, reason }, payload: { available: false, reason } };
}
function todayToronto(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}
function eventDate(value: string | null | undefined, fallback: string): string {
  const d = new Date(String(value ?? ''));
  if (Number.isNaN(d.getTime())) return fallback;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}
function shiftDate(isoDate: string, offsetDays: number): string {
  const d = new Date(isoDate + 'T12:00:00Z');
  if (Number.isNaN(d.getTime())) return isoDate;
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}
function implied(american: number | null): number | null {
  if (american == null || !Number.isFinite(american) || american === 0) return null;
  return american > 0 ? 100 / (american + 100) : -american / (-american + 100);
}
function grade(p: number): 'A' | 'B' | 'C' | 'D' {
  return p >= 0.65 ? 'A' : p >= 0.58 ? 'B' : p >= 0.5 ? 'C' : 'D';
}
function roundPct(p: number): number {
  return Math.round(p * 1000) / 10;
}

function sgoMoneylineCandidate(event: Awaited<ReturnType<typeof sgo.getSgoSlateEvents>>['events'][number], date: string, checkedAt?: string): any | null {
  const rows: any[] = Array.isArray(event.markets?.h2h) ? event.markets.h2h : [];
  const home = rows.find((row) => row?.teamSide === 'home');
  const away = rows.find((row) => row?.teamSide === 'away');
  const homeOdds = Number(home?.bookOdds);
  const awayOdds = Number(away?.bookOdds);
  if (!Number.isFinite(homeOdds) || !Number.isFinite(awayOdds) || homeOdds === 0 || awayOdds === 0) return null;
  const homeRaw = implied(homeOdds);
  const awayRaw = implied(awayOdds);
  if (homeRaw == null || awayRaw == null || homeRaw + awayRaw <= 0) return null;
  const homeNoVig = homeRaw / (homeRaw + awayRaw);
  const awayNoVig = awayRaw / (homeRaw + awayRaw);
  const pickHome = homeNoVig >= awayNoVig;
  const chosen = pickHome ? home : away;
  const team = pickHome ? event.home : event.away;
  const opponent = pickHome ? event.away : event.home;
  const odds = pickHome ? homeOdds : awayOdds;
  const probability = pickHome ? homeNoVig : awayNoVig;
  const opponentOdds = pickHome ? awayOdds : homeOdds;
  const bookNames = Object.keys(chosen?.byBookmaker ?? {});
  return {
    candidateType: 'game_market',
    entityType: 'team',
    sport: event.league.toLowerCase(),
    eventId: event.id,
    eventDate: eventDate(event.commenceTime, date),
    team,
    opponent,
    homeAway: pickHome ? 'home' : 'away',
    market: 'moneyline',
    selection: team + ' ML',
    side: null,
    suggestedLine: null,
    marketLine: null,
    marketOdds: odds,
    marketOddsOver: null,
    marketOddsUnder: null,
    opponentOdds,
    confidencePct: roundPct(probability),
    rawImpliedPct: roundPct(pickHome ? homeRaw : awayRaw),
    noVigProbabilityPct: roundPct(probability),
    grade: grade(probability),
    modelVersion: 'market-consensus-v1',
    qualitySource: 'market-consensus-v1',
    source: 'api.sportsgameodds.com',
    marketSource: 'api.sportsgameodds.com',
    marketCheckedAt: checkedAt,
    marketBook: 'SportsGameOdds consensus',
    books: bookNames,
    bookCount: bookNames.length,
    lineType: 'primary',
    lineLabel: 'CONSENSUS MONEYLINE',
    note: 'Two-sided consensus moneyline with vig removed. This is market-implied probability, not an independent team-performance forecast.',
  };
}

async function espnFallback(sport: Sport, date: string, requested: number): Promise<any[]> {
  // ESPN scoreboards only carry the current week: if the requested date has no
  // discovered events, scan forward day-by-day (up to 8 days) so a moneyline
  // request mid-week still finds the next slate instead of returning empty.
  let events: any[] = [];
  for (let offset = 0; offset < 8 && !events.length; offset++) {
    const day = shiftDate(date, offset);
    events = (await discoverSlateEvents(sport, day).catch(() => []))
      .filter((event) => !/final|completed|postponed|canceled|cancelled/i.test(String(event.status ?? '')));
  }
  events = events.slice(0, Math.min(8, Math.max(4, requested * 2)));
  const out: any[] = [];
  for (const event of events) {
    const odds = await espnOdds.getGameOdds(event.away.name, event.home.name, sport).catch(() => null);
    if (!odds?.available || !odds.moneyline) continue;
    const homeOdds = espnOdds.parseAmerican(odds.moneyline.home);
    const awayOdds = espnOdds.parseAmerican(odds.moneyline.away);
    const homeRaw = implied(homeOdds);
    const awayRaw = implied(awayOdds);
    if (homeRaw == null || awayRaw == null || homeRaw + awayRaw <= 0 || homeOdds == null || awayOdds == null) continue;
    const homeNoVig = homeRaw / (homeRaw + awayRaw);
    const awayNoVig = awayRaw / (homeRaw + awayRaw);
    const pickHome = homeNoVig >= awayNoVig;
    const probability = pickHome ? homeNoVig : awayNoVig;
    const team = pickHome ? event.home.name : event.away.name;
    const opponent = pickHome ? event.away.name : event.home.name;
    const selectedOdds = pickHome ? homeOdds : awayOdds;
    out.push({
      candidateType: 'game_market',
      entityType: 'team',
      sport,
      eventId: event.eventId,
      eventDate: event.date,
      team,
      opponent,
      homeAway: pickHome ? 'home' : 'away',
      market: 'moneyline',
      selection: team + ' ML',
      side: null,
      suggestedLine: null,
      marketLine: null,
      marketOdds: selectedOdds,
      opponentOdds: pickHome ? awayOdds : homeOdds,
      confidencePct: roundPct(probability),
      rawImpliedPct: roundPct(pickHome ? homeRaw : awayRaw),
      noVigProbabilityPct: roundPct(probability),
      grade: grade(probability),
      modelVersion: 'single-book-no-vig-v1',
      qualitySource: 'single-book-no-vig-v1',
      source: odds.source,
      marketSource: odds.source,
      marketBook: odds.provider ?? 'ESPN sportsbook',
      books: odds.provider ? [odds.provider] : [],
      bookCount: odds.provider ? 1 : 0,
      lineType: 'primary',
      lineLabel: 'LIVE MONEYLINE',
      note: 'Two-sided live sportsbook price with vig removed. Single-book fallback; confirm current price before wagering.',
    });
  }
  return out;
}

const handler = async (args: any): Promise<ToolOutcome> => {
  const sport = String(args?.sport ?? 'nfl').toLowerCase() as Sport;
  if (!['mlb', 'nfl', 'nba', 'nhl'].includes(sport)) return unavailable('unsupported sport ' + sport);
  const market = String(args?.market ?? 'moneyline').toLowerCase();
  if (!['moneyline', 'ml', 'h2h'].includes(market)) {
    return unavailable('game_market_screener currently supports moneyline/h2h; spreads and totals remain available through game_odds');
  }
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(args?.date ?? '')) ? String(args.date) : todayToronto();
  const requested = Math.min(10, Math.max(1, Number(args?.requestedPicks ?? 5) || 5));
  const minConfidence = Math.max(0.5, Math.min(0.8, Number(args?.minConfidence ?? 0.54) || 0.54));

  let candidates: any[] = [];
  const live = await sgo.getSgoSlateEvents(sport, 12).catch(() => null);
  if (live?.available) {
    candidates = live.events.map((event) => sgoMoneylineCandidate(event, date, live.checkedAt)).filter(Boolean);
  }
  let provider = 'SportsGameOdds consensus';
  if (!candidates.length) {
    candidates = await espnFallback(sport, date, requested);
    provider = 'ESPN sportsbook fallback';
  }
  const qualified = candidates
    .filter((candidate) => Number(candidate.confidencePct) / 100 >= minConfidence)
    .sort((a, b) => Number(b.confidencePct) - Number(a.confidencePct));

  const payload = {
    available: qualified.length > 0,
    sport,
    date,
    market: 'moneyline',
    provider,
    candidates: qualified.slice(0, Math.max(requested * 2, requested)),
    slate: {
      evaluatedGames: candidates.length,
      qualifiedCandidates: qualified.length,
    },
    methodology: 'Rank one moneyline side per game using live two-sided prices with vig removed. This is consensus market probability, not a claim of independent +EV.',
  };
  if (!qualified.length) return unavailable('no live moneyline candidates cleared the requested confidence floor');
  return ok(
    sport.toUpperCase() + ' moneyline screener found ' + qualified.length + ' qualified team plays from ' + candidates.length + ' priced games',
    payload,
  );
};

export const GAME_MARKET_SCREENER_TOOL: ToolDef = {
  name: 'game_market_screener',
  description: 'Deterministic slate-wide GAME market screener. Use for moneyline/ML/h2h requests instead of the player-prop screener. It reads live two-sided team prices, removes vig, ranks one moneyline side per game, and returns attributable market-consensus confidence. It never substitutes player props for an explicit moneyline request.',
  parameters: {
    type: 'object',
    properties: {
      sport: { type: 'string', enum: ['mlb', 'nfl', 'nba', 'nhl'] },
      market: { type: 'string', enum: ['moneyline', 'ml', 'h2h'] },
      date: { type: 'string', description: 'YYYY-MM-DD; defaults to today in America/Toronto' },
      requestedPicks: { type: 'number', description: 'How many moneyline plays the user requested' },
      minConfidence: { type: 'number', description: 'Minimum no-vig market probability; default 0.54' },
    },
    required: ['sport', 'market'],
  },
  handler,
};
