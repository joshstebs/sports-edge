import type { OddsBoardEvent, OddsBoardMarket, OddsBoardSelection } from '../workspace.js';

const MARKETS: OddsBoardMarket[] = ['h2h', 'spreads', 'totals'];

function fields(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function timestamp(value: unknown): string | null {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export function isAmericanPrice(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && Math.abs(value) >= 100;
}

/** Event, market, selection and exact point define the comparison. */
export function normalizeFeaturedOdds(value: unknown, now = Date.now()): OddsBoardEvent[] {
  const events: OddsBoardEvent[] = [];
  for (const event of array(value)) {
    const { id, home_team, away_team, commence_time, bookmakers } = fields(event);
    const home = text(home_team);
    const away = text(away_team);
    const commenceTime = timestamp(commence_time);
    if (!text(id) || !home || !away || !commenceTime || Date.parse(commenceTime) <= now) continue;
    const groups = new Map<string, OddsBoardSelection>();
    for (const rawBook of array(bookmakers)) {
      const book = fields(rawBook);
      const name = text(book.title);
      if (!name) continue;
      for (const rawMarket of array(book.markets)) {
        const market = fields(rawMarket);
        const key = market.key as OddsBoardMarket;
        if (!MARKETS.includes(key)) continue;
        for (const rawOutcome of array(market.outcomes)) {
          const outcome = fields(rawOutcome);
          const selection = text(outcome.name);
          const line = key === 'h2h' ? null : outcome.point;
          if (!selection || !isAmericanPrice(outcome.price) ||
            (key !== 'h2h' && (typeof line !== 'number' || !Number.isFinite(line)))) continue;
          const groupKey = JSON.stringify([key, selection.toLowerCase(), line]);
          const group = groups.get(groupKey) ?? { market: key, name: selection, line: line as number | null, quotes: [] };
          const quote = { book: name, odds: outcome.price, updatedAt: timestamp(market.last_update) ?? timestamp(book.last_update) };
          const previous = group.quotes.findIndex(row => row.book.toLowerCase() === name.toLowerCase());
          if (previous < 0) group.quotes.push(quote);
          else if ((quote.updatedAt ?? '') > (group.quotes[previous].updatedAt ?? '')) group.quotes[previous] = quote;
          groups.set(groupKey, group);
        }
      }
    }
    if (groups.size) events.push({ id: text(id), home, away, commenceTime, selections: [...groups.values()] });
  }
  return events.sort((a, b) => a.commenceTime.localeCompare(b.commenceTime)).slice(0, 24);
}
