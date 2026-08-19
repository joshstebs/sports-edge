import test from 'node:test';
import assert from 'node:assert/strict';
import { apiSportsGet, findPlayer, apiSportsSeasonForNow } from '../src/providers/apiSports.js';

function response(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

test('API-Sports fails closed when key is missing', async () => {
  const previous = process.env.API_SPORTS_KEY;
  delete process.env.API_SPORTS_KEY;
  try {
    const result = await apiSportsGet('nfl', '/players', { search: 'Allen' }, async () => { throw new Error('should not fetch'); });
    assert.equal(result.available, false);
    assert.match(result.reason ?? '', /not configured/i);
  } finally {
    if (previous == null) delete process.env.API_SPORTS_KEY; else process.env.API_SPORTS_KEY = previous;
  }
});

test('API-Sports sends only server-side key header and parses quota', async () => {
  const previous = process.env.API_SPORTS_KEY;
  process.env.API_SPORTS_KEY = 'test-key';
  try {
    let seenHeader = '';
    const result = await apiSportsGet<any[]>('nfl', '/players', { search: 'Allen' }, async (_url, init) => {
      seenHeader = new Headers(init?.headers).get('x-apisports-key') ?? '';
      return response({ errors: [], response: [{ id: 1, name: 'Josh Allen' }] }, 200, {
        'x-ratelimit-requests-remaining': '91',
        'x-ratelimit-remaining': '289',
      });
    });
    assert.equal(result.available, true);
    assert.equal(seenHeader, 'test-key');
    assert.equal(result.remainingDaily, 91);
    assert.equal(result.remainingMinute, 289);
  } finally {
    if (previous == null) delete process.env.API_SPORTS_KEY; else process.env.API_SPORTS_KEY = previous;
  }
});

test('findPlayer chooses an exact API-Sports match', async () => {
  const previous = process.env.API_SPORTS_KEY;
  process.env.API_SPORTS_KEY = 'test-key';
  try {
    const result = await findPlayer('nfl', 'Josh Allen', async () => response({
      errors: [],
      response: [{ id: 2, name: 'Josh Allen' }, { id: 3, name: 'Josh Allen Jr.' }],
    }));
    assert.equal(result.available, true);
    assert.equal(result.data?.id, 2);
  } finally {
    if (previous == null) delete process.env.API_SPORTS_KEY; else process.env.API_SPORTS_KEY = previous;
  }
});

test('API-Sports envelope errors become unavailable instead of fake data', async () => {
  const previous = process.env.API_SPORTS_KEY;
  process.env.API_SPORTS_KEY = 'test-key';
  try {
    const result = await apiSportsGet('nba', '/players', { search: 'Curry' }, async () => response({
      errors: { search: 'invalid search' }, response: [],
    }));
    assert.equal(result.available, false);
    assert.match(result.reason ?? '', /invalid search/i);
  } finally {
    if (previous == null) delete process.env.API_SPORTS_KEY; else process.env.API_SPORTS_KEY = previous;
  }
});

test('season helper uses season start year', () => {
  assert.equal(apiSportsSeasonForNow(new Date('2026-08-19T00:00:00Z')), 2026);
  assert.equal(apiSportsSeasonForNow(new Date('2026-02-01T00:00:00Z')), 2025);
});
