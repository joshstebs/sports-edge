import assert from 'node:assert/strict';
import test from 'node:test';
import { applyTrustedQuote } from '../src/lib/trustedQuotes.js';

test('player prop prices must match a current tool-returned quote for the same event', () => {
  const now = Date.now();
  const candidate = { sport: 'nba', player: 'Example Player', eventDate: '2026-11-06', eventId: 'game-1',
    market: 'points', side: 'over', marketLine: 20.5, marketOddsOver: -110,
    marketSource: 'sportsbook-provider', marketCheckedAt: new Date(now).toISOString() };
  const leg = { sport: 'NBA', player_name: 'Example Player', eventDate: '2026-11-06', eventId: 'game-1',
    selection: 'Example Player OVER 20.5 Points', market: 'points', side: 'over', line: 20.5, odds: -110, line_verified: true,
    line_source: 'model-claims-a-book', line_checked_at: new Date(now).toISOString() };
  const verified = applyTrustedQuote(leg, [candidate], now);
  assert.equal(verified.line_verified, true);
  assert.equal(verified.line_source, 'sportsbook-provider');
  for (const altered of [
    { eventId: 'game-2' }, { eventDate: '2026-11-05' }, { player_name: 'Other Player' },
    { line: 21.5 }, { side: 'under' }, { odds: 150 }, { market: 'rebounds' },
    { selection: 'Other Player over 20.5 points' }, { selection: 'Example Player under 20.5 points' },
    { selection: 'Example Player over 21.5 points' }, { selection: 'Example Player over 20.5 rebounds' },
    { selection: 'Other Player 25+ points' },
  ]) assert.equal(applyTrustedQuote({ ...leg, ...altered }, [candidate], now).line_verified, false);
  assert.equal(applyTrustedQuote(leg, [], now).line_verified, false, 'Model-authored fields are not proof');
  assert.equal(applyTrustedQuote(leg, [{ ...candidate, marketCheckedAt: new Date(now - 16 * 60_000).toISOString() }], now).line_verified, false);
  const threes = { ...candidate, market: 'threePointersMade', marketLine: 2.5 };
  assert.equal(applyTrustedQuote({ ...leg, market: 'threePointersMade', line: 2.5, selection: 'Example Player OVER 2.5 3-Pointers' }, [threes], now).line_verified, true);
});

test('team moneyline prices must match the event, team and price', () => {
  const now = Date.now();
  const candidate = { candidateType: 'game_market', sport: 'nfl', eventId: 'game-a', eventDate: '2026-11-06',
    team: 'Buffalo Bills', market: 'moneyline', marketOdds: -140,
    marketSource: 'espn', marketCheckedAt: new Date(now).toISOString() };
  const leg = { entity_type: 'team', sport: 'NFL', team: 'Buffalo Bills', eventId: 'game-a', eventDate: '2026-11-06',
    selection: 'Buffalo Bills ML', market: 'moneyline', odds: -140, line_verified: true };
  assert.equal(applyTrustedQuote(leg, [candidate], now).line_verified, true);
  assert.equal(applyTrustedQuote({ ...leg, team: 'Other Team' }, [candidate], now).line_verified, false);
  assert.equal(applyTrustedQuote({ ...leg, odds: 140 }, [candidate], now).line_verified, false);
});
