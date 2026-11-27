import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeFeaturedOdds } from '../src/providers/oddsBoard.js';

test('bookmaker board compares the same event, side, market and exact line', () => {
  const now = Date.parse('2026-11-27T20:00:00Z');
  const matchup = { home_team: 'Boston', away_team: 'Toronto', commence_time: '2026-11-28T00:30:00Z' };
  const spreads = (point: number, price: number, updatedAt: string) => ({
    key: 'spreads', last_update: updatedAt, outcomes: [
      { name: 'Boston', point, price },
      { name: 'Toronto', point: -point, price },
      { name: 'Invalid odds', point, price: 10 },
      { name: 'Missing line', price: -110 },
    ],
  });
  const older = '2026-11-27T19:40:00Z';
  const newer = '2026-11-27T19:55:00Z';
  const bookmakers = [
    { title: 'Book A', markets: [spreads(-2.5, -110, older)] },
    { title: 'Book A', markets: [spreads(-2.5, -105, newer)] },
    { title: 'Book B', markets: [spreads(-2.5, 100, older), spreads(-3.5, 130, older)] },
  ];
  const board = normalizeFeaturedOdds([
    { ...matchup, id: 'one', bookmakers },
    { ...matchup, id: 'two', bookmakers: [bookmakers[0]] },
    { ...matchup, id: 'started', commence_time: '2026-11-27T19:59:00Z', bookmakers },
  ], now);
  assert.deepEqual(board.map(event => event.id), ['one', 'two']);
  const first = board[0].selections;
  assert.equal(first.length, 4);
  assert.deepEqual(first.find(row => row.name === 'Boston' && row.line === -2.5)?.quotes, [
    { book: 'Book A', odds: -105, updatedAt: '2026-11-27T19:55:00.000Z' },
    { book: 'Book B', odds: 100, updatedAt: '2026-11-27T19:40:00.000Z' },
  ]);
  assert.equal(first.find(row => row.name === 'Boston' && row.line === -3.5)?.quotes[0].odds, 130);
  assert.equal(board[1].selections[0].quotes.length, 1);
});
