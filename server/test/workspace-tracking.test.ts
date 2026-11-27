import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { hashPassword } from '../src/auth/password.js';
import { AUTH_COOKIE_NAME, createSessionToken } from '../src/auth/session.js';
import type { TrackingSnapshot } from '../src/workspace.js';

async function listen(server: Server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
}

test('workspace tracking scopes local records, previews overlaps, and reads the native BetIQ comparison', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'sportsedge-tracking-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  for (const name of ['VERCEL', 'VERCEL_ENV', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'BETTRACK_URL', 'BETTRACK_API_KEY', 'BETIQ_URL']) {
    delete process.env[name];
  }

  const secret = randomBytes(48).toString('base64url');
  const passwordHash = await hashPassword('workspace-test-password');
  process.env.NODE_ENV = 'test';
  process.env.APP_ORIGIN = 'http://localhost:5180';
  process.env.AUTH_SESSION_SECRET = secret;
  process.env.AUTH_USERS_JSON = JSON.stringify(['admin', 'tester'].map((role) => ({
    id: role, username: role, role, passwordHash,
  })));
  process.env.SPORTS_EDGE_DATA_DIR = dataDir;

  const eventId = 'a'.repeat(32);
  const createdAt = '2026-10-10T12:00:00Z';
  const pick = { selection: 'Boston -2.5', status: 'won', market: 'spreads', line: -2.5, odds: -110, eventId, createdAt };
  const originalLedger = { picks: [
    { ...pick, id: 'leg-a', userId: 'admin' },
    { ...pick, id: 'leg-b', userId: 'tester' },
    { ...pick, id: 'legacy-a', line: -3, selection: 'Boston -3' },
    { ...pick, id: 'different-event', eventId: 'b'.repeat(32), userId: 'admin' },
  ] };
  const ledgerPath = join(dataDir, 'ledger.json');
  await writeFile(ledgerPath, JSON.stringify(originalLedger));

  let upstreamFailure = false;
  const upstream = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    res.setHeader('Content-Type', 'application/json');
    if (url.pathname === '/api/mcp/bets' && req.headers.authorization === 'Bearer sk_test' && url.searchParams.get('limit') === '50') {
      const game = { externalId: eventId, homeTeamName: 'Boston', awayTeamName: 'Toronto', commenceTime: '2026-10-10T22:00:00Z' };
      const leg = { selection: 'home', selectionType: 'spread', status: 'won', odds: -110, line: '-3', game };
      return res.end(JSON.stringify({ status: 'success', data: { total: 1, bets: [{
        id: 'track-a', name: 'Boston ticket', status: 'won', placedAt: createdAt,
        legs: [
          { ...leg, id: 'track-leg-a', userAdjustedLine: '-2.5', userAdjustedOdds: -105 },
          { ...leg, id: 'track-leg-b', selection: 'away', line: '2.5' },
        ],
      }] } }));
    }
    if (url.pathname === '/api/user-picks' && !req.headers.authorization) {
      if (upstreamFailure) return res.writeHead(503).end();
      return res.end(JSON.stringify([{
        id: 'iq-a', bet_type: 'straight', status: 'SETTLED_WIN', game_date: '2026-10-10',
        submitted_at: '2026-10-10T11:00:00', combined_odds: 1.95, notes: 'private note',
        legs_detail: [{ id: 1, description: 'Boston moneyline', market_type: 'Moneyline', odds_american: -105, leg_result: 'WIN' }],
      }]));
    }
    if (url.pathname === '/api/ab-test/comparison'
      && url.searchParams.get('days') === '7'
      && url.searchParams.get('ingestion_filter') === 'pregame_only'
      && url.searchParams.get('include_cashouts') === 'false') {
      return res.end(JSON.stringify({
        period: { since: '2026-10-04' },
        user: { n_settled: 3, wins: 2, losses: 1, total_pnl: 4, roi_pct: 10, wr_pct: 66.67 },
        model: { n_settled: 0, wins: 0, losses: 0, total_pnl: 0, roi_pct: null, wr_pct: null },
      }));
    }
    res.writeHead(404).end();
  });
  const origin = await listen(upstream);
  t.after(() => upstream.close());

  const { default: app } = await import('../src/app.js');
  const server = createServer(app);
  const base = await listen(server);
  t.after(() => server.close());
  const endpoint = `${base}/api/workspace/tracking`;
  const headers = (role: 'admin' | 'tester') => ({
    Cookie: `${AUTH_COOKIE_NAME}=${createSessionToken({ userId: role, username: role, role }, secret, 3600)}`,
  });

  assert.equal((await fetch(endpoint)).status, 401);
  assert.equal((await fetch(endpoint, { headers: headers('tester') })).status, 403);
  assert.equal((await fetch(`${endpoint}?days=14`, { headers: headers('admin') })).status, 400);

  const propLearning = `${base}/api/workspace/prop-learning`;
  assert.equal((await fetch(propLearning)).status, 401);
  assert.equal((await fetch(propLearning, { headers: headers('tester') })).status, 403);
  const propReport = await fetch(propLearning, { headers: headers('admin') });
  assert.equal(propReport.status, 200);
  assert.deepEqual(await propReport.json(), { tracked: 0, pending: 0, settled: 0, trends: [] });
  assert.equal((await fetch(`${propLearning}/scan`, {
    method: 'POST',
    headers: { ...headers('admin'), Origin: process.env.APP_ORIGIN!, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sport: 'nba', market: 'not-a-market' }),
  })).status, 400);

  const board = `${base}/api/odds-board`;
  assert.equal((await fetch(`${board}?sport=nba`)).status, 402);
  assert.equal((await fetch(`${board}?sport=unknown`, { headers: headers('tester') })).status, 400);
  assert.equal((await fetch(`${board}/game?sport=nba&event=abc`, { headers: headers('admin') })).status, 400);

  const unconfiguredResponse = await fetch(endpoint, { headers: headers('admin') });
  assert.match(unconfiguredResponse.headers.get('cache-control') ?? '', /no-store/);
  const unconfigured = await unconfiguredResponse.json() as TrackingSnapshot;
  assert.equal(unconfigured.sources.BetTrack.status, 'unconfigured');
  assert.equal(unconfigured.comparison.status, 'unconfigured');

  process.env.BETTRACK_URL = origin;
  process.env.BETTRACK_API_KEY = 'sk_test';
  process.env.BETIQ_URL = origin;
  const read = async () => await (await fetch(`${endpoint}?days=7`, { headers: headers('admin') })).json() as TrackingSnapshot;
  const snapshot = await read();
  assert(snapshot.sources.SportsEdge.status === 'ready');
  assert.deepEqual(snapshot.sources.SportsEdge.data.entries.map((entry) => entry.id), ['leg-a', 'legacy-a', 'different-event']);
  assert.deepEqual(snapshot.overlaps, [{ ticketId: 'track-a', selectionId: 'track-leg-a', sportsEdgeIds: ['leg-a'] }]);
  assert(snapshot.sources.BetTrack.status === 'ready');
  assert.equal(snapshot.sources.BetTrack.data.entries[0].selections[0].americanOdds, -105);
  assert(snapshot.sources.BetIQ.status === 'ready');
  assert.equal(snapshot.sources.BetIQ.data.entries[0].recordedAt, '2026-10-10T11:00:00.000Z');
  assert.equal(snapshot.sources.BetIQ.data.entries[0].selections[0].eventId, null);
  assert(!JSON.stringify(snapshot).includes('private note'));
  assert(snapshot.comparison.status === 'ready');
  assert.equal(snapshot.comparison.data.user.roi, 10);
  assert.equal(snapshot.comparison.data.model.profit, null);

  upstreamFailure = true;
  const partial = await read();
  assert.equal(partial.sources.BetIQ.status, 'unavailable');
  assert.equal(partial.comparison.status, 'ready');
  assert.deepEqual(JSON.parse(await readFile(ledgerPath, 'utf8')), originalLedger);
});
