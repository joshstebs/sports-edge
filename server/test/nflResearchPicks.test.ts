import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hashPassword } from '../src/auth/password.js';
import { renderScreenerSummaryBlocks } from '../src/llm/screenerRenderer.js';
import {
  FAST_SLATE_SCREENER_TOOL,
  currentSeasonStartYear,
  needsPriorSeasonFallback,
  priorSeasonParam,
  seasonLabelMatches,
} from '../src/llm/fastSlateScreenerTool.js';
import { inferScreenerIntent, runAgent, selectDisplayableCandidates } from '../src/llm/chatClient.js';
import { getToolSchemas } from '../src/llm/toolRegistry.js';
import { parseParlayQualityPolicy } from '../src/lib/parlayQuality.js';

const DATE = '2026-11-08';
const SEASON_LABEL = '2026 Regular Season';
const NFL_NAMES = [
  'passingAttempts', 'passingYards', 'passingTouchdowns',
  'rushingAttempts', 'rushingYards', 'rushingTouchdowns',
  'receptions', 'receivingTargets', 'receivingYards', 'receivingTouchdowns',
];

type FixturePlayer = {
  id: string;
  name: string;
  position: 'QB' | 'RB' | 'WR' | 'TE';
  stats: Record<string, number>;
};

function statArray(stats: Record<string, number>): string[] {
  return NFL_NAMES.map((name) => String(stats[name] ?? 0));
}

function player(id: string, name: string, position: FixturePlayer['position'], stats: Record<string, number>): FixturePlayer {
  return { id, name, position, stats };
}

function nflRoster(): FixturePlayer[] {
  return [
    player('p1', 'Fixture Quarterback', 'QB', { passingAttempts: 35, passingYards: 275, passingTouchdowns: 2 }),
    player('p2', 'Fixture Runner', 'RB', { rushingAttempts: 15, rushingYards: 75, receptions: 2, receivingTargets: 3 }),
    player('p3', 'Fixture Receiver One', 'WR', { receptions: 6, receivingTargets: 8, receivingYards: 80 }),
    player('p4', 'Fixture Receiver Two', 'WR', { receptions: 6, receivingTargets: 8, receivingYards: 80 }),
    player('p5', 'Fixture Tight End', 'TE', { receptions: 6, receivingTargets: 8, receivingYards: 80 }),
    player('p6', 'Fixture Injured Receiver', 'WR', { receptions: 6, receivingTargets: 8, receivingYards: 80 }),
  ];
}

function gamelogFor(fixture: FixturePlayer, games: number, label = SEASON_LABEL, year = 2026) {
  const events = Array.from({ length: games }, (_, index) => ({
    eventId: `${fixture.id}-e${index + 1}`,
    gameDate: `${year}-${index < 5 ? '10' : '11'}-${String(index + 1).padStart(2, '0')}T00:00:00Z`,
    stats: statArray(fixture.stats),
  }));
  return {
    names: NFL_NAMES,
    seasonTypes: [{
      displayName: label,
      categories: [{ events: events.map((event) => ({ eventId: event.eventId, stats: event.stats })) }],
    }],
    events: Object.fromEntries(events.map((event) => [
      event.eventId,
      { gameDate: event.gameDate, opponent: { displayName: 'Fixture Opponent' } },
    ])),
  };
}

function scoreboardEvent() {
  return {
    id: 'nfl-1',
    date: `${DATE}T17:00:00Z`,
    status: { type: { name: 'STATUS_SCHEDULED', state: 'pre', completed: false } },
    competitions: [{
      competitors: [
        { homeAway: 'home', team: { id: '1', displayName: 'Fixture Home' } },
        { homeAway: 'away', team: { id: '2', displayName: 'Fixture Away' } },
      ],
    }],
  };
}

function rosterPayload(fixtures: FixturePlayer[]) {
  return {
    athletes: [{
      position: 'offense',
      items: fixtures.map((fixture) => ({
        id: fixture.id,
        displayName: fixture.name,
        position: { abbreviation: fixture.position },
      })),
    }],
  };
}

function injuriesPayload(injuredName?: string) {
  return {
    injuries: injuredName
      ? [{
          id: '1',
          displayName: 'Fixture Home',
          injuries: [{
            id: 'injury-1',
            athlete: { id: 'p6', displayName: injuredName, team: { id: '1', displayName: 'Fixture Home' } },
            status: 'Out',
          }],
        }]
      : [],
  };
}

interface MockOptions {
  games?: number;
  label?: string;
  year?: number;
  injuredName?: string;
  priorGames?: number;
  priorLabel?: string;
  oddsFailure?: '401' | '429' | 'timeout' | 'network' | null;
  capturedUrls?: string[];
  capturedHeaders?: string[];
  /** Pass localhost requests through to the real fetch (for SSE tests). */
  passthrough?: typeof fetch;
}

function installEspnMock(options: MockOptions = {}) {
  const fixtures = nflRoster();
  const games = options.games ?? 10;
  const label = options.label ?? SEASON_LABEL;
  const year = options.year ?? 2026;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input);
    if (options.passthrough && url.startsWith('http://127.0.0.1:')) {
      return options.passthrough(input, init);
    }
    options.capturedUrls?.push(url);
    if (url.includes('sportsgameodds') || url.includes('sharpapi')) {
      const headers = new Headers(init?.headers);
      options.capturedHeaders?.push(`${headers.get('x-api-key') ?? ''}|${headers.get('X-API-Key') ?? ''}`);
      if (options.oddsFailure === 'timeout') throw new DOMException('provider timeout', 'TimeoutError');
      if (options.oddsFailure === 'network') throw new TypeError('fetch failed');
      const status = options.oddsFailure === '429' ? 429 : 401;
      return new Response('{"error":"provider unavailable"}', {
        status,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.includes('/injuries')) return Response.json(injuriesPayload(options.injuredName));
    if (url.includes('/scoreboard')) return Response.json({ events: [scoreboardEvent()] });
    // The fixture slate has two teams; return the roster only for the home
    // team so a player cannot appear twice with different team labels.
    if (url.includes('/teams/2/roster')) return Response.json({ athletes: [] });
    if (url.includes('/roster')) return Response.json(rosterPayload(fixtures));
    if (url.includes('/gamelog')) {
      const id = /\/athletes\/([^/]+)\/gamelog/.exec(url)?.[1] ?? '';
      const fixture = fixtures.find((row) => row.id === id);
      if (!fixture) throw new Error('Unknown athlete ' + id);
      if (url.includes('season=')) {
        const requestedSeason = Number(/season=(\d+)/.exec(url)?.[1]);
        // NFL prior-season query uses the season start year.
        if (requestedSeason !== 2025 || !options.priorGames) {
          return Response.json({ available: false, reason: 'no prior games' });
        }
        return Response.json(gamelogFor(fixture, options.priorGames, options.priorLabel ?? '2025 Regular Season', 2025));
      }
      return Response.json(gamelogFor(fixture, games, label, year));
    }
    throw new Error('Unexpected endpoint: ' + url);
  }) as typeof fetch;
  return () => { globalThis.fetch = originalFetch; };
}

function clearOddsKeys() {
  const keys = ['SPORTSGAMEODDS_API_KEY', 'SPORTSGAMEODDS_API_KEY_2', 'SHARPAPI_API_KEY', 'ODDS_API_KEY', 'THE_ODDS_API_KEY'];
  const saved = keys.map((key) => process.env[key]);
  keys.forEach((key) => delete process.env[key]);
  return () => {
    keys.forEach((key, index) => {
      if (saved[index] == null) delete process.env[key];
      else process.env[key] = saved[index];
    });
  };
}

test('five NFL research picks render without odds, with L5/L10 and individual games', async () => {
  const restoreFetch = installEspnMock({ injuredName: 'Fixture Injured Receiver' });
  const restoreKeys = clearOddsKeys();
  try {
    const result = await FAST_SLATE_SCREENER_TOOL.handler({ sport: 'nfl', date: DATE, requestedPicks: 5 });
    assert.equal(result.available, true, result.reason);
    const payload: any = result.payload;
    assert.equal(payload.slate.priceProviderAvailable, false);
    assert.equal(payload.slate.verifiedCandidates, 0);
    assert.ok(payload.slate.gates.injuryExcluded >= 1, 'the confirmed-out player must be excluded');
    assert.ok(payload.candidates.length >= 5);

    const players = payload.candidates.map((candidate: any) => candidate.player);
    assert.equal(new Set(players).size, players.length, 'one candidate per player');
    assert.equal(players.includes('Fixture Injured Receiver'), false);

    for (const candidate of payload.candidates) {
      assert.equal(candidate.recommendationType, 'research');
      assert.equal(candidate.researchOnly, true);
      assert.equal(candidate.marketLine, null);
      assert.equal(candidate.marketOddsOver, null);
      assert.equal(candidate.marketOddsUnder, null);
      assert.equal(candidate.estimatedEdge, null);
      assert.equal(candidate.gameDate, DATE);
      assert.ok(candidate.seasonSampleSize >= 3);
      assert.ok(Array.isArray(candidate.recentGames) && candidate.recentGames.length === Math.min(5, candidate.seasonSampleSize));
      assert.equal(typeof candidate.historicalThreshold, 'number');
      assert.ok(candidate.historicalThresholdSource.includes('not a sportsbook line'));
    }

    const rendered = renderScreenerSummaryBlocks(payload.candidates, 5, payload.slate);
    assert.match(rendered, /Research-only statistical picks — NOT verified sportsbook lines/);
    assert.match(rendered, /Research Pick — Odds Unavailable/);
    assert.match(rendered, /L5 /);
    assert.match(rendered, /L10 /);
    assert.match(rendered, /last 5: G1 /);
    assert.match(rendered, /2026-11-08/);
    assert.match(rendered, /historical threshold .* \(NOT a sportsbook line\)/);
    assert.match(rendered, /opponent defensive ranking vs this position: not available/);
    assert.match(rendered, /source: site\.web\.api\.espn\.com/);
    assert.doesNotMatch(rendered, /```sgp/);
    assert.doesNotMatch(rendered, /\[PREDICTION_LOG\]/);
    assert.doesNotMatch(rendered, /\bGrade [A-D]\b/);
    assert.doesNotMatch(rendered, /[+-]\d{3,4}\b/, 'research picks must not print American odds');
    assert.doesNotMatch(rendered, /\bEV\b\s*[:+-]?\s*\d/i);
    assert.doesNotMatch(rendered, /implied probability\s*[:=]?\s*\d/i);
  } finally {
    restoreFetch();
    restoreKeys();
  }
});

test('deterministic NFL research runs without an LLM or odds provider', async () => {
  const restoreFetch = installEspnMock({ injuredName: 'Fixture Injured Receiver' });
  const restoreKeys = clearOddsKeys();
  try {
    const result = await runAgent(
      { configured: false, provider: 'none', model: '', models: [], baseUrl: '' },
      [{ role: 'user', content: 'Give me 5 NFL player-prop picks for 2026-11-08 based on the last 5 and 10 games.' }],
      getToolSchemas(),
    );
    assert.match(result.content, /Research-only statistical picks — NOT verified sportsbook lines/);
    assert.match(result.content, /Research Pick — Odds Unavailable/);
    assert.match(result.content, /NFL|Fixture Receiver/);
    assert.doesNotMatch(result.content, /```sgp/);
    assert.doesNotMatch(result.content, /\[PREDICTION_LOG\]/);
    assert.doesNotMatch(result.content, /No LLM API key configured/);
  } finally {
    restoreFetch();
    restoreKeys();
  }
});

test('an explicitly stale prior-season gamelog never becomes current NFL form', async () => {
  // Current season label for the reference date is 2026. A 2025 label means
  // the endpoint fell back to last season and must not populate L5/L10.
  assert.equal(seasonLabelMatches('nfl', '2026 Regular Season', new Date(`${DATE}T12:00:00Z`)), true);
  assert.equal(seasonLabelMatches('nfl', '2025 Regular Season', new Date(`${DATE}T12:00:00Z`)), false);
  assert.equal(seasonLabelMatches('nba', '2026-27 Regular Season', new Date(`${DATE}T12:00:00Z`)), true);
  assert.equal(seasonLabelMatches('nba', '2025-26 Regular Season', new Date(`${DATE}T12:00:00Z`)), false);
  assert.equal(currentSeasonStartYear('nba', new Date(`${DATE}T12:00:00Z`)), 2026);
  assert.equal(currentSeasonStartYear('nfl', new Date('2027-01-15T12:00:00Z')), 2026);
  assert.equal(priorSeasonParam('nba', new Date(`${DATE}T12:00:00Z`)), 2026);
  assert.equal(priorSeasonParam('nfl', new Date(`${DATE}T12:00:00Z`)), 2025);

  const restoreFetch = installEspnMock({ games: 10, label: '2025 Regular Season', year: 2025 });
  const restoreKeys = clearOddsKeys();
  try {
    const result = await FAST_SLATE_SCREENER_TOOL.handler({ sport: 'nfl', date: DATE, requestedPicks: 5 });
    assert.equal(result.available, false, 'a stale prior-season log must not produce picks');
    assert.match(String(result.reason), /enough recent-game history/);
  } finally {
    restoreFetch();
    restoreKeys();
  }
});

test('fewer than five current games fail closed instead of padding research picks', async () => {
  assert.equal(needsPriorSeasonFallback('nfl', 4), true);
  const restoreFetch = installEspnMock({ games: 4 });
  const restoreKeys = clearOddsKeys();
  try {
    const result = await FAST_SLATE_SCREENER_TOOL.handler({ sport: 'nfl', date: DATE, requestedPicks: 5 });
    assert.equal(result.available, false);
    assert.match(String(result.reason), /enough recent-game history/);
    assert.doesNotMatch(JSON.stringify(result), /Research-only statistical picks/);
  } finally {
    restoreFetch();
    restoreKeys();
  }
});

test('NFL research survives 401, 429, timeout and network provider failures without leaking keys', async () => {
  for (const failure of ['401', '429', 'timeout', 'network'] as const) {
    const capturedUrls: string[] = [];
    const capturedHeaders: string[] = [];
    const restoreFetch = installEspnMock({ oddsFailure: failure, capturedUrls, capturedHeaders });
    const keys = ['SPORTSGAMEODDS_API_KEY', 'SPORTSGAMEODDS_API_KEY_2', 'SHARPAPI_API_KEY'];
    const saved = keys.map((key) => process.env[key]);
    const secrets = ['fixture-sgo-a', 'fixture-sgo-b', 'fixture-sharp-a'];
    process.env.SPORTSGAMEODDS_API_KEY = secrets[0];
    process.env.SPORTSGAMEODDS_API_KEY_2 = secrets[1];
    process.env.SHARPAPI_API_KEY = secrets[2];
    try {
      const result = await FAST_SLATE_SCREENER_TOOL.handler({ sport: 'nfl', date: DATE, requestedPicks: 5 });
      assert.equal(result.available, true, `${failure}: ${result.reason}`);
      const payload: any = result.payload;
      assert.equal(payload.slate.priceProviderAvailable, false, failure);
      assert.ok(payload.candidates.length >= 5, failure);
      assert.ok(payload.candidates.every((candidate: any) => candidate.recommendationType === 'research'), failure);
      assert.ok(capturedUrls.some((url) => url.includes('sportsgameodds')), `${failure}: SGO must be attempted`);
      assert.equal(capturedUrls.some((url) => secrets.some((secret) => url.includes(secret))), false, failure);
      assert.equal(capturedHeaders.some((header) => secrets.some((secret) => header.includes(secret))), true, failure);
      const rendered = renderScreenerSummaryBlocks(payload.candidates, 5, payload.slate);
      assert.doesNotMatch(rendered, /[+-]\d{3,4}\b/, `${failure}: no invented odds`);
      assert.equal(secrets.some((secret) => rendered.includes(secret)), false, failure);
    } finally {
      restoreFetch();
      keys.forEach((key, index) => {
        if (saved[index] == null) delete process.env[key];
        else process.env[key] = saved[index];
      });
    }
  }
});

test('pick-count parsing ignores lookback windows and keeps market-qualified counts', () => {
  assert.equal(inferScreenerIntent('Give me 5 NFL player-prop picks based on the last 5 and 10 games.').requestedPicks, 5);
  assert.equal(inferScreenerIntent('Give me 5 NFL passing yards props').requestedPicks, 5);
  assert.equal(inferScreenerIntent('Give me 5 NFL anytime touchdown picks using L5 and L10').requestedPicks, 5);
  assert.equal(inferScreenerIntent('Build a 5-6 leg NFL SGP').requestedPicks, 6);
  const policy = parseParlayQualityPolicy('Give me 5 NFL player props based on the last 5 and 10 games');
  assert.equal(policy.requestedMin, 5);
  assert.equal(policy.requestedMax, 5);
});

test('research candidates are the only unpriced NFL rows allowed to display', () => {
  const priced = {
    sport: 'nfl', player: 'Priced Receiver', eventId: 'nfl-1', eventDate: DATE,
    market: 'receivingYards', side: 'over', marketLine: 59.5, marketOddsOver: -110,
    marketSource: 'api.sportsgameodds.com', marketCheckedAt: new Date().toISOString(), confidencePct: 62,
  };
  const labeledResearch = {
    sport: 'nfl', player: 'Research Receiver', eventId: 'nfl-2', eventDate: DATE,
    market: 'receivingYards', side: 'over', marketLine: null, recommendationType: 'research', researchOnly: true,
  };
  const unlabeledUnpriced = {
    sport: 'nfl', player: 'Legacy Unpriced', eventId: 'nfl-3', eventDate: DATE,
    market: 'receivingYards', side: 'over', marketLine: null,
  };
  const kept = selectDisplayableCandidates([priced, labeledResearch, unlabeledUnpriced]);
  assert.deepEqual(kept.map((row) => row.player), ['Priced Receiver', 'Research Receiver']);
});

test('NFL research reaches the SSE client under strict evidence gating', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-nfl-research-sse-'));
  const env = { ...process.env };
  const originalFetch = globalThis.fetch;
  const restoreFetch = installEspnMock({
    injuredName: 'Fixture Injured Receiver',
    passthrough: originalFetch,
  });
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
  for (const key of [
    'VERCEL', 'VERCEL_ENV', 'AUTH_ADMIN_PASSWORD_HASH',
    'SPORTSGAMEODDS_API_KEY', 'SPORTSGAMEODDS_API_KEY_2', 'SHARPAPI_API_KEY',
    'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN',
    'GROQ_API_KEY', 'GEMINI_API_KEY', 'OPENROUTER_API_KEY', 'OPENCODE_ZEN_API_KEY',
  ]) delete process.env[key];

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

    const response = await fetch(base + '/api/chat', {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        sport: 'NFL',
        messages: [{ role: 'user', content: 'Give me 5 NFL player-prop picks for 2026-11-08 based on the last 5 and 10 games.' }],
      }),
    });
    assert.equal(response.status, 200);
    const stream = await response.text();
    assert.match(stream, /event: done/);
    assert.doesNotMatch(stream, /event: error/);
    assert.doesNotMatch(stream, /Recommendation withheld/);
    const delta = [...stream.matchAll(/^event: delta\ndata: (.*)$/gm)]
      .map((match) => JSON.parse(match[1]).text).join('');
    assert.match(delta, /Research-only statistical picks — NOT verified sportsbook lines/);
    assert.match(delta, /Research Pick — Odds Unavailable/);
    assert.match(delta, /2026-11-08/);
    assert.doesNotMatch(stream, /event: sgp/);
    assert.doesNotMatch(stream, /\[PREDICTION_LOG\]/);
    assert.doesNotMatch(delta, /[+-]\d{3,4}\b/);
  } finally {
    restoreFetch();
    globalThis.fetch = originalFetch;
    if (server) await new Promise<void>((resolve, reject) => server.close((error: any) => error ? reject(error) : resolve()));
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
    Object.assign(process.env, env);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
