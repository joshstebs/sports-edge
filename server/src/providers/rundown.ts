// Rundown (therundown.io) odds provider.
//
// Coverage note: Rundown exposes GAME markets only — moneyline, handicap
// (spread) and totals — with per-book prices. It does not publish player props,
// so `playerProps` is always empty here; callers must keep their existing prop
// providers and treat this as a game-line source.
//
// Auth is the `key` QUERY PARAMETER, not a header: `x-api-key` returns 401 even
// with a valid key.

import type { GameOdds } from './oddsAggregator.js';

const BASE = 'https://therundown.io/api/v2';
const SPORT_IDS: Record<string, number> = { mlb: 3, nfl: 2, nba: 4, nhl: 6 };

type RundownPrice = { price?: number; is_main_line?: boolean; updated_at?: string };
type RundownParticipant = {
  name?: string;
  type?: string;
  lines?: Array<{ value?: number; prices?: Record<string, RundownPrice> }>;
};
type RundownMarket = { name?: string; participants?: RundownParticipant[] };
type RundownTeam = { name?: string; mascot?: string; abbreviation?: string; is_home?: boolean; is_away?: boolean };
type RundownEvent = {
  event_id?: string;
  event_date?: string;
  teams?: RundownTeam[];
  markets?: RundownMarket[];
};

function apiKey(): string | undefined {
  const value = process.env.RUNDOWN_API_KEY;
  return value && value.trim() ? value.trim() : undefined;
}

export function rundownConfigured(): boolean {
  return Boolean(apiKey());
}

let bookNames: { at: number; map: Record<string, string> } = { at: 0, map: {} };

async function loadBookNames(key: string): Promise<Record<string, string>> {
  if (Date.now() - bookNames.at < 60 * 60 * 1000 && Object.keys(bookNames.map).length) return bookNames.map;
  try {
    const res = await fetch(`${BASE}/affiliates?key=${encodeURIComponent(key)}`, { cache: 'no-store' });
    if (!res.ok) return bookNames.map;
    const body = (await res.json()) as { affiliates?: Array<{ affiliate_id?: number; affiliate_name?: string }> };
    const map: Record<string, string> = {};
    for (const a of body.affiliates ?? []) {
      if (a.affiliate_id != null && a.affiliate_name) map[String(a.affiliate_id)] = a.affiliate_name;
    }
    bookNames = { at: Date.now(), map };
    return map;
  } catch {
    return bookNames.map;
  }
}

function teamName(team?: RundownTeam): string {
  if (!team) return '';
  return [team.name, team.mascot].filter(Boolean).join(' ').trim() || team.abbreviation || '';
}

function bestPrice(prices: Record<string, RundownPrice> | undefined): { price: number; book: string } | null {
  if (!prices) return null;
  let best: { price: number; book: string } | null = null;
  for (const [bookId, entry] of Object.entries(prices)) {
    const price = entry?.price;
    if (typeof price !== 'number' || !Number.isFinite(price)) continue;
    if (price === -10000 || price === 10000) continue; // Rundown's "no market" sentinel
    if (!best || price > best.price) best = { price, book: bookId };
  }
  return best;
}

function mainLine(participant: RundownParticipant | undefined): { value?: number; prices?: Record<string, RundownPrice> } {
  const lines = participant?.lines ?? [];
  const main = lines.find(line => Object.values(line.prices ?? {}).some(p => p?.is_main_line)) ?? lines[0];
  return main ?? {};
}

export async function fetchRundownOdds(sports: string[] = ['nba', 'nfl', 'nhl', 'mlb']): Promise<GameOdds[]> {
  const key = apiKey();
  if (!key) return [];
  const names = await loadBookNames(key);
  const dates = [new Date(), new Date(Date.now() + 86400000)].map(d => d.toISOString().slice(0, 10));
  const out: GameOdds[] = [];

  for (const sport of sports) {
    const sportId = SPORT_IDS[sport.toLowerCase()];
    if (!sportId) continue;
    for (const date of dates) {
      let events: RundownEvent[] = [];
      try {
        const res = await fetch(`${BASE}/sports/${sportId}/events/${date}?key=${encodeURIComponent(key)}`, { cache: 'no-store' });
        if (!res.ok) continue;
        const body = (await res.json()) as { events?: RundownEvent[] };
        events = body.events ?? [];
      } catch {
        continue;
      }

      for (const event of events) {
        const homeTeam = event.teams?.find(t => t.is_home);
        const awayTeam = event.teams?.find(t => t.is_away);
        if (!event.event_id || !homeTeam || !awayTeam) continue;

        const moneyline = (event.markets ?? []).find(m => m.name === 'moneyline');
        const handicap = (event.markets ?? []).find(m => m.name === 'handicap');
        const totals = (event.markets ?? []).find(m => m.name === 'totals');

        const homeName = teamName(homeTeam);
        const awayName = teamName(awayTeam);
        const homeML = moneyline?.participants?.find(p => p.name === homeName || p.name?.includes(teamName(homeTeam)));
        const awayML = moneyline?.participants?.find(p => p.name === awayName);
        const homeBest = bestPrice(mainLine(homeML).prices);
        const awayBest = bestPrice(mainLine(awayML).prices);
        if (!homeBest || !awayBest) continue;

        const homeSpread = mainLine(handicap?.participants?.find(p => p.name === homeName));
        const awaySpread = mainLine(handicap?.participants?.find(p => p.name === awayName));
        const homeSpreadPrice = bestPrice(homeSpread.prices);
        const awaySpreadPrice = bestPrice(awaySpread.prices);

        const over = mainLine(totals?.participants?.find(p => (p.name ?? '').toLowerCase().startsWith('over')));
        const under = mainLine(totals?.participants?.find(p => (p.name ?? '').toLowerCase().startsWith('under')));
        const overPrice = bestPrice(over.prices);
        const underPrice = bestPrice(under.prices);
        if (homeSpread.value == null || over.value == null || !homeSpreadPrice || !awaySpreadPrice || !overPrice || !underPrice) continue;

        out.push({
          gameId: event.event_id,
          sport: sport.toLowerCase(),
          homeTeam: homeName,
          awayTeam: awayName,
          startTime: event.event_date ?? '',
          moneyline: { home: homeBest.price, away: awayBest.price },
          spread: { line: homeSpread.value, homeOdds: homeSpreadPrice.price, awayOdds: awaySpreadPrice.price },
          total: { line: over.value, over: overPrice.price, under: underPrice.price },
          playerProps: [],
          books: [...new Set([names[homeBest.book], names[awayBest.book], names[homeSpreadPrice.book], names[overPrice.book]].filter(Boolean))],
          lastUpdated: new Date().toISOString(),
        });
      }
    }
  }
  return out;
}
