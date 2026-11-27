import assert from 'node:assert/strict';
import test from 'node:test';
import { findClosingMarket, parseAmericanPrice } from '../src/lib/closingMarket.js';
import type { OddsMarket } from '../src/providers/oddsAggregator.js';

const t = Date.parse('2026-11-29T18:00:00Z');
const selection = { player: 'Joe Test', market: 'player_points', side: 'over' as const, line: 0 };
const quote: OddsMarket = {
  market: selection.market, side: selection.side, line: 0, odds: -110,
  book: 'book-a', lastUpdated: new Date(t - 60_000).toISOString(),
};

test('closing matcher requires exact player, selection, valid price and pregame quote', () => {
  const markets = [
    { ...quote, line: 0.5 },
    { ...quote, odds: 1.91 },
    { ...quote, lastUpdated: new Date(t + 1).toISOString() },
    { ...quote, lastUpdated: new Date(t - 3_600_001).toISOString() },
  ];
  const game = { playerProps: [
    { playerName: 'Joe Test Jr.', markets: [quote], sport: 'nba', gameId: 'a', bestLines: {} },
    { playerName: 'joe  test', markets, sport: 'nba', gameId: 'a', bestLines: {} },
  ] };
  const window = { from: t - 3_600_000, through: t };
  assert.equal(findClosingMarket(game, selection, window), null);
  markets.push(quote);
  assert.equal(findClosingMarket(game, selection, window), quote);
});

test('American price parser rejects decimals and partial strings', () => {
  assert.equal(parseAmericanPrice('+110'), 110);
  assert.equal(parseAmericanPrice(-110), -110);
  for (const value of ['~+110', '110.5', 1.91, '99', null]) {
    assert.equal(parseAmericanPrice(value), null);
  }
});
