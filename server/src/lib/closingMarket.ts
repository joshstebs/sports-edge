import type { GameOdds, OddsMarket } from '../providers/oddsAggregator.js';

function normalizedName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function parseAmericanPrice(value: unknown): number | null {
  const text = typeof value === 'string' ? value.trim() : String(value);
  if (!/^[+-]?\d+$/.test(text)) return null;
  const odds = Number(text);
  return Number.isSafeInteger(odds) && Math.abs(odds) >= 100 ? odds : null;
}

export function findClosingMarket(
  game: Pick<GameOdds, 'playerProps'>,
  selection: { player: string; market: string; side: 'over' | 'under'; line: number },
  window: { from: number; through: number },
): OddsMarket | null {
  const player = normalizedName(selection.player);
  if (!player || !selection.market || !Number.isFinite(selection.line)) return null;
  let match: OddsMarket | null = null;
  for (const prop of game.playerProps) {
    if (normalizedName(prop.playerName) !== player) continue;
    for (const market of prop.markets) {
      if (market.market !== selection.market || market.side !== selection.side ||
          market.line !== selection.line || parseAmericanPrice(market.odds) === null) continue;
      const observedAt = Date.parse(market.lastUpdated);
      if (!Number.isFinite(observedAt) || observedAt < window.from || observedAt > window.through) continue;
      if (match === null || observedAt > Date.parse(match.lastUpdated) ||
          (observedAt === Date.parse(match.lastUpdated) && market.book.localeCompare(match.book) < 0)) {
        match = market;
      }
    }
  }
  return match;
}
