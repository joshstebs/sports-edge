import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveSlateDate } from '../src/llm/slateDate.js';
import { discoverSlateEvents, discoverUpcomingNflSlate } from '../src/providers/slateDiscovery.js';
import { GAME_MARKET_SCREENER_TOOL } from '../src/llm/gameMarketScreenerTool.js';
import { renderScreenerSummaryBlocks } from '../src/llm/screenerRenderer.js';
import { finalizeStructuredParlay, parseParlayQualityPolicy } from '../src/lib/parlayQuality.js';
import { runAgent } from '../src/llm/chatClient.js';

test('undated NFL requests find the next slate; explicit Toronto dates stay exact', () => {
  const now = new Date('2026-10-04T00:30:00Z'); // Saturday evening in Toronto
  assert.deepEqual(resolveSlateDate('Best NFL bets', now), { date: '2026-10-03', searchUpcoming: true });
  for (const text of ['NFL tomorrow', 'NFL Sunday', 'NFL 2026-10-04']) {
    assert.deepEqual(resolveSlateDate(text, now), { date: '2026-10-04', searchUpcoming: false });
  }
  assert.deepEqual(resolveSlateDate('NFL tonight', now), { date: '2026-10-03', searchUpcoming: false });
});

test('off-day discovery and ESPN fallback survive the real renderer/verification pipeline', async () => {
  const originalFetch = globalThis.fetch;
  const keys = ['SPORTSGAMEODDS_API_KEY', 'SPORTSGAMEODDS_API_KEY_2'];
  const saved = keys.map((key) => process.env[key]);
  keys.forEach((key) => delete process.env[key]);
  const urls: string[] = [];
  const event = (id: string, date: string, status = 'STATUS_SCHEDULED') => ({
    id, date, status: { type: { name: status } }, competitions: [{ competitors: [
      { homeAway: 'away', team: { id: '2', displayName: 'Buffalo Bills' } },
      { homeAway: 'home', team: { id: '17', displayName: 'New England Patriots' } },
    ] }],
  });
  globalThis.fetch = (async (input: any) => {
    const url = String(input); urls.push(url);
    if (url.endsWith('/scoreboard?dates=20261003')) return Response.json({ events: [] });
    if (url.endsWith('/scoreboard?dates=20261004')) return Response.json({ events: [event('sunday', '2026-10-04T17:00:00Z')] });
    if (url.endsWith('/roster')) return Response.json({ athletes: [] });
    if (url === 'https://llm.test/chat/completions') return new Response(
      'data: ' + JSON.stringify({ choices: [{ delta: { content: 'Unresearched model answer' } }] }) + '\n\ndata: [DONE]\n\n',
    );
    if (url.endsWith('/scoreboard')) return Response.json({ events: [
      event('finished', '2026-10-02T00:15:00Z', 'STATUS_FINAL'),
      event('sunday', '2026-10-04T17:00:00Z'),
      event('monday', '2026-10-06T00:15:00Z'),
    ] });
    if (url.endsWith('/summary?event=sunday')) return Response.json({ pickcenter: [{
      provider: { name: 'DraftKings' }, moneyline: {
        away: { close: { odds: '-200' } }, home: { close: { odds: '+170' } },
      },
    }] });
    throw new Error('Unexpected endpoint: ' + url);
  }) as typeof fetch;
  try {
    assert.deepEqual(await discoverSlateEvents('nfl', '2026-10-03'), []);
    const next = await discoverUpcomingNflSlate('2026-10-03');
    assert.equal(next.length, 1);
    assert.equal(next[0].eventId, 'sunday');
    assert.equal(next[0].date, '2026-10-04');
    const result = await GAME_MARKET_SCREENER_TOOL.handler({ sport: 'nfl', date: '2026-10-03', searchUpcoming: true, requestedPicks: 1 });
    assert.equal(result.available, true);
    const candidates = (result.payload as any).candidates;
    assert.ok(candidates[0].marketCheckedAt);
    const text = renderScreenerSummaryBlocks(candidates, 1);
    const legs = JSON.parse(/```sgp\s*([\s\S]*?)```/.exec(text)![1]).legs;
    const finalized = finalizeStructuredParlay(legs, parseParlayQualityPolicy('1 pick'));
    assert.equal(finalized.complete, true);
    assert.equal(finalized.legs[0].team, 'Buffalo Bills');
    assert.equal(finalized.legs[0].game_date, '2026-10-04');
    assert.equal(finalized.legs[0].line_verified, true);
    assert.equal(urls.filter((url) => url.endsWith('/summary?event=sunday')).length, 1);
    const stale = [{ ...legs[0], line_checked_at: new Date(Date.now() - 20 * 60_000).toISOString() }];
    assert.equal(finalizeStructuredParlay(stale, parseParlayQualityPolicy('1 pick')).complete, false);
    const exact = await GAME_MARKET_SCREENER_TOOL.handler({ sport: 'nfl', date: '2026-10-03', searchUpcoming: false });
    assert.equal(exact.available, false, 'an explicit off-day must not silently return Sunday bets');
    const events: string[] = [];
    const agent = await runAgent({
      configured: true, provider: 'groq', model: 'fixture', models: ['fixture'], baseUrl: 'https://llm.test',
    }, [{ role: 'user', content: 'Best NFL bets 2026-10-04' }], [], {
      onToolEvent: (event) => { if (event.status === 'running') events.push(event.name); },
    });
    assert.ok(events.includes('slate_candidate_screener'));
    assert.ok(events.includes('game_market_screener'));
    assert.match(agent.content, /Buffalo Bills ML/);
    assert.doesNotMatch(agent.content, /Unresearched model answer/);
  } finally {
    globalThis.fetch = originalFetch;
    keys.forEach((key, i) => { if (saved[i] == null) delete process.env[key]; else process.env[key] = saved[i]; });
  }
});
