import assert from 'node:assert/strict';
import test from 'node:test';
import { deterministicScreenerCalls, inferScreenerIntent } from '../src/llm/chatClient.js';

function user(content: string) {
  return { role: 'user' as const, content };
}

test('a sport tab focus routes an unqualified pick request to that screener', () => {
  for (const [sport, expected] of [['nba', 'nba'], ['nfl', 'nfl']] as const) {
    const calls = deterministicScreenerCalls([user('Give me 5 picks')], sport);
    assert.ok(calls.length > 0, `${sport} request must produce a screener call`);
    assert.equal(calls[0].parsed.sport, expected);
  }
});

test('the chat sport selection in the system prompt routes the deterministic screener', () => {
  const calls = deterministicScreenerCalls([
    { role: 'system', content: 'You are an analyst. Focus analysis on NFL.' },
    user('Give me 5 player props'),
  ]);
  assert.ok(calls.length > 0);
  assert.equal(calls[0].parsed.sport, 'nfl');
});

test('explicit sport text wins over the selected sport tab', () => {
  const calls = deterministicScreenerCalls([user('Give me 5 NFL player props')], 'nba');
  assert.ok(calls.length > 0);
  assert.equal(calls[0].parsed.sport, 'nfl');

  const nbaCalls = deterministicScreenerCalls([user('Give me 5 NBA player props')], 'nfl');
  assert.ok(nbaCalls.length > 0);
  assert.equal(nbaCalls[0].parsed.sport, 'nba');
});

test('NBA-specific markets route to the NBA screener market filter', () => {
  const intent = inferScreenerIntent('Give me 5 NBA assists props');
  assert.equal(intent.sport, 'nba');
  assert.equal(intent.market, 'assists');
  assert.equal(intent.requestKind, 'player_prop');
});
