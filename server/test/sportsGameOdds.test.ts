import assert from 'node:assert/strict';
import test from 'node:test';
import { getSgoFeaturedOdds, getSgoGameOdds } from '../src/providers/sportsGameOdds.js';

function event(id: string, away: string, home: string) {
  return {
    eventID: id,
    leagueID: 'NBA',
    status: { started: false, completed: false, live: false, startsAt: '2026-08-23T00:00:00Z' },
    teams: { home: { names: { long: home, short: home } }, away: { names: { long: away, short: away } } },
    odds: {
      'points-home-game-ml-home': { bookOdds: -110, fairOdds: -108 },
      'points-away-game-ml-away': { bookOdds: '+105', fairOdds: 103 },
    },
  };
}

test('SportsGameOdds keeps credentials in headers and searches bounded later pages', async () => {
  const previousKey = process.env.SPORTSGAMEODDS_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.SPORTSGAMEODDS_API_KEY = 'test-server-only-key';
  const requests: Array<{ url: URL; key: string | null }> = [];
  globalThis.fetch = (async (input, init) => {
    const url = new URL(String(input));
    requests.push({ url, key: new Headers(init?.headers).get('x-api-key') });
    const cursor = url.searchParams.get('cursor');
    const body = cursor
      ? { data: [event('target', 'Lakers', 'Celtics')], nextCursor: null }
      : { data: [event('first', 'Toronto Raptors', 'New York Knicks')], nextCursor: 'page-2' };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  try {
    const featured = await getSgoFeaturedOdds('nba');
    assert.equal(featured.available, true);
    assert.equal(featured.event?.id, 'first');
    assert.equal(typeof featured.markets?.h2h?.[0]?.bookOdds, 'number');

    const matchup = await getSgoGameOdds('Lakers', 'Celtics', 'nba');
    assert.equal(matchup.available, true);
    assert.equal(matchup.event?.id, 'target');
    assert.equal(requests.some(({ url }) => url.searchParams.get('cursor') === 'page-2'), true);
    for (const request of requests) {
      assert.equal(request.url.searchParams.has('apiKey'), false, 'credentials must not appear in provider URLs');
      assert.equal(request.key, 'test-server-only-key');
    }
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.SPORTSGAMEODDS_API_KEY;
    else process.env.SPORTSGAMEODDS_API_KEY = previousKey;
  }
});

test('SportsGameOdds fails closed when its optional key is absent', async () => {
  const previousKey = process.env.SPORTSGAMEODDS_API_KEY;
  delete process.env.SPORTSGAMEODDS_API_KEY;
  try {
    const result = await getSgoFeaturedOdds('nba');
    assert.equal(result.available, false);
    assert.match(result.reason ?? '', /not configured/i);
  } finally {
    if (previousKey !== undefined) process.env.SPORTSGAMEODDS_API_KEY = previousKey;
  }
});
