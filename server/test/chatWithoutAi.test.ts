import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hashPassword } from '../src/auth/password.js';

test('authenticated chat produces verified NFL picks with broken or absent AI credentials', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-chat-no-ai-'));
  const env = { ...process.env };
  const originalFetch = globalThis.fetch;
  const origin = 'http://sportsedge.test';
  const password = 'local-fixture-password';
  process.env.NODE_ENV = 'test';
  process.env.APP_ORIGIN = origin;
  process.env.AUTH_SESSION_SECRET = 'local-fixture-session-secret-for-tests-only';
  process.env.AUTH_USERS_JSON = JSON.stringify([
    { id: 'local-admin', username: 'admin', role: 'admin', passwordHash: await hashPassword(password) },
    { id: 'local-tester', username: 'tester', role: 'tester', passwordHash: await hashPassword(password) },
  ]);
  process.env.SPORTS_EDGE_DATA_DIR = dataDir;
  process.env.EVIDENCE_GATE = 'strict';
  process.env.GROQ_API_KEY = 'invalid-fixture-key';
  process.env.GEMINI_API_KEY = 'invalid-fixture-key';
  for (const key of ['VERCEL', 'VERCEL_ENV', 'AUTH_ADMIN_PASSWORD_HASH', 'SPORTSGAMEODDS_API_KEY', 'SPORTSGAMEODDS_API_KEY_2', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) delete process.env[key];
  let aiCalls = 0;
  let withPlayerHistory = false;
  globalThis.fetch = (async (input: any, options?: any) => {
    const url = String(input);
    if (url.startsWith('http://127.0.0.1:')) return originalFetch(input, options);
    if (/groq|generativelanguage/.test(url)) {
      aiCalls++;
      return Response.json({ error: { message: 'Invalid API Key' } }, { status: 401 });
    }
    if (url.endsWith('/scoreboard?dates=20261004')) return Response.json({ events: Array.from({ length: 6 }, (_, i) => ({
      id: String(100 + i), date: '2026-10-04T17:00:00Z', status: { type: { name: 'STATUS_SCHEDULED' } },
      competitions: [{ competitors: [
        { homeAway: 'away', team: { id: String(20 + i), displayName: 'Away ' + i } },
        { homeAway: 'home', team: { id: String(30 + i), displayName: 'Home ' + i } },
      ] }],
    })) });
    if (url.endsWith('/roster')) return Response.json({ athletes: withPlayerHistory ? [
      { id: 'fixture-receiver', displayName: 'Fixture Receiver', position: { abbreviation: 'WR' } },
    ] : [] });
    if (url.includes('/athletes/fixture-receiver/gamelog')) return Response.json({
      names: ['receivingYards', 'receptions'],
      seasonTypes: [{ displayName: '2026 Regular Season', categories: [{ events: Array.from({ length: 6 }, (_, i) => ({
        eventId: String(i), stats: [i < 4 ? '80' : '0', '5'],
      })) }] }],
      events: Object.fromEntries(Array.from({ length: 6 }, (_, i) => [String(i), { gameDate: `2026-09-${20 - i}` }])),
    });
    if (url.includes('/summary?event=')) return Response.json({ pickcenter: [{
      provider: { name: 'DraftKings' }, moneyline: {
        away: { close: { odds: '-200' } }, home: { close: { odds: '+170' } },
      },
    }] });
    throw new Error('Unexpected upstream: ' + url);
  }) as typeof fetch;
  let server: any;
  try {
    const { default: app } = await import('../src/app.js');
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const base = 'http://127.0.0.1:' + server.address().port;
    const login = await fetch(base + '/api/auth/login', {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    for (const configured of [true, false]) {
      if (!configured) { delete process.env.GROQ_API_KEY; delete process.env.GEMINI_API_KEY; }
      const response = await fetch(base + '/api/chat', {
        method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify({ sport: 'NFL', messages: [{ role: 'user', content: 'Give me 5 picks for NFL 2026-10-04' }] }),
      });
      assert.equal(response.status, 200);
      const stream = await response.text();
      assert.doesNotMatch(stream, /event: error|Invalid API Key|No LLM API key configured/);
      const block = /event: sgp\ndata: (.*)/.exec(stream);
      assert.ok(block, stream);
      const legs = JSON.parse(block[1]).legs;
      assert.equal(legs.length, 5);
      assert.ok(legs.every((leg: any) => leg.line_verified === true && leg.sport === 'NFL'));
      assert.match(stream, /deterministic-live-data/);
    }
    assert.equal(aiCalls, 0);
    withPlayerHistory = true;
    const { FAST_SLATE_SCREENER_TOOL } = await import('../src/llm/fastSlateScreenerTool.js');
    const screened = await FAST_SLATE_SCREENER_TOOL.handler({ sport: 'nfl', date: '2026-10-04', requestedPicks: 1 });
    assert.equal(screened.available, true);
    const candidate = screened.payload.candidates[0];
    assert.equal(candidate.sport, 'nfl');
    assert.ok(candidate.modelVersion);
    assert.match(candidate.source, /espn/);
  } finally {
    globalThis.fetch = originalFetch;
    if (server) await new Promise<void>((resolve, reject) => server.close((error: any) => error ? reject(error) : resolve()));
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
    Object.assign(process.env, env);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
