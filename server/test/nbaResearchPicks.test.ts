import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { hashPassword } from '../src/auth/password.js';
import { renderScreenerSummaryBlocks } from '../src/llm/screenerRenderer.js';
import {
  SPORT_MARKETS,
  buildResearchForm,
  minutesFromStats,
} from '../src/llm/fastSlateScreenerTool.js';
import { runAgent, selectDisplayableCandidates } from '../src/llm/chatClient.js';
import { getToolSchemas } from '../src/llm/toolRegistry.js';
import { minimumSampleFor } from '../src/models/playerPropModel.js';
import { finalizeStructuredParlay, parseParlayQualityPolicy } from '../src/lib/parlayQuality.js';

function researchCandidate(index: number, overrides: Record<string, unknown> = {}) {
  const points = 30 - index;
  return {
    player: `Player ${index + 1}`,
    team: 'Boston Celtics',
    opponent: 'New York Knicks',
    homeAway: 'away',
    matchupContext: '@ New York Knicks',
    sport: 'nba',
    eventDate: '2026-11-07',
    eventId: 'nba-1',
    market: 'points',
    side: 'over',
    recommendationType: 'research',
    researchOnly: true,
    suggestedLine: 27.5,
    modelLine: 27.5,
    historicalThreshold: 27.5,
    projection: 29.1,
    l5Average: points + 0.4,
    l10Average: points - 0.2,
    seasonAverage: points - 1.1,
    seasonSampleSize: 12,
    minutesL5: 36.2,
    minutesL10: 35.7,
    consistencyStdDev: 4.1,
    consistencyLabel: 'medium',
    hitFrequency: 0.8,
    historicalWins: 8,
    historicalLosses: 2,
    historicalPushes: 0,
    dataDate: '2026-11-06',
    opponentSampleSize: 2,
    opponentAverage: 28.5,
    rationale: 'Projection +1.6 vs historical threshold; 80% empirical hit rate across 10 decisions',
    grade: 'B',
    sampleSize: 12,
    confidencePct: 80,
    marketLine: null,
    marketOddsOver: null,
    marketOddsUnder: null,
    marketSource: null,
    marketCheckedAt: null,
    estimatedEdge: null,
    edgeOver: null,
    edgeUnder: null,
    ...overrides,
  };
}

function verifiedCandidate(index: number) {
  return {
    player: `Verified ${index + 1}`,
    team: 'Boston Celtics',
    opponent: 'New York Knicks',
    sport: 'nba',
    eventDate: '2026-11-07',
    eventId: 'nba-1',
    market: 'points',
    side: 'over',
    recommendationType: 'verified',
    researchOnly: false,
    suggestedLine: 24.5,
    modelLine: 24.5,
    marketLine: 24.5,
    marketOddsOver: -110,
    marketOddsUnder: -110,
    marketSource: 'api.sportsgameodds.com',
    marketCheckedAt: new Date().toISOString(),
    estimatedEdge: 4.2,
    edgeOver: 4.2,
    edgeUnder: null,
    confidencePct: 60,
    grade: 'B',
    sampleSize: 20,
  };
}

test('NBA screener supports points, rebounds, assists, made threes and PRA', () => {
  assert.deepEqual(SPORT_MARKETS.nba, [
    'points',
    'rebounds',
    'assists',
    'threePointersMade',
    'pointsReboundsAssists',
  ]);
});

test('research form exposes L5/L10/season, minutes, consistency, hit frequency and opponent sample', () => {
  assert.equal(minutesFromStats({ minutes: '34:12' }), 34.2);
  assert.equal(minutesFromStats({ minutes: '34' }), 34);
  assert.equal(minutesFromStats({}), null);

  const values = [30, 28, 32, 25, 29, 27, 31, 26, 30, 28, 24, 22];
  const opponents = ['New York Knicks', 'New York Knicks', ...Array.from({ length: 10 }, () => 'Boston Celtics')];
  const form = buildResearchForm({
    values,
    minutes: values.map(() => 35),
    opponents,
    opponentName: 'New York Knicks',
    threshold: 27.5,
    side: 'over',
    dataDate: '2026-11-07',
  });

  assert.equal(form.l5Average, 28.8);
  assert.equal(form.l10Average, 28.6);
  assert.equal(form.seasonAverage, 27.7);
  assert.equal(form.seasonSampleSize, 12);
  assert.equal(form.projection, 28.5);
  assert.equal(form.minutesL5, 35);
  assert.equal(form.minutesL10, 35);
  assert.equal(form.consistencyStdDev, 2.2);
  assert.equal(form.consistencyLabel, 'high');
  assert.equal(form.wins, 7);
  assert.equal(form.losses, 5);
  assert.equal(form.hitFrequency, 0.5833333333333334);
  assert.equal(form.opponentSampleSize, 2);
  assert.equal(form.opponentAverage, 29);
  assert.equal(form.dataDate, '2026-11-07');
});

test('NBA picks render as a research-only section when no verified line exists', () => {
  const rendered = renderScreenerSummaryBlocks(
    Array.from({ length: 5 }, (_, index) => researchCandidate(index)),
    5,
  );

  assert.match(rendered, /No verified sportsbook picks were found/);
  assert.match(rendered, /Research-only statistical picks — NOT verified sportsbook lines/);
  assert.match(rendered, /L5 30\.4/);
  assert.match(rendered, /L10 29\.8/);
  assert.match(rendered, /season\/sample 28\.9 \(12 g\)/);
  assert.match(rendered, /historical threshold 27\.5 \(NOT a sportsbook line\)/);
  assert.match(rendered, /hit 8\/10 decisions \(80%\)/);
  assert.match(rendered, /data through 2026-11-06/);
  assert.match(rendered, /@ New York Knicks/);
  assert.match(rendered, /vs New York Knicks: 2 g, 28\.5 avg/);
  assert.doesNotMatch(rendered, /```sgp/);
  assert.doesNotMatch(rendered, /\[PREDICTION_LOG\]/);
  assert.doesNotMatch(rendered, /[-+]\d{3,4}\b/, 'research picks must not print odds');
});

test('research picks target the requested count without padding', () => {
  const rendered = renderScreenerSummaryBlocks(
    Array.from({ length: 8 }, (_, index) => researchCandidate(index)),
    5,
  );
  const numbered = rendered.match(/^\d+\. \*\*Player/gm) ?? [];
  assert.equal(numbered.length, 5);
});

test('verified and research picks stay separate and only verified enter the structured slip', () => {
  const rendered = renderScreenerSummaryBlocks([verifiedCandidate(0), researchCandidate(1)], 2);

  assert.match(rendered, /Verified slate screen — 1 qualified candidate/);
  assert.match(rendered, /Research-only statistical picks/);
  assert.match(rendered, /Player 2/);

  const match = /```sgp\s*([\s\S]*?)```/.exec(rendered);
  assert.ok(match, 'verified picks must still emit the structured SGP block');
  const legs = JSON.parse(match[1]).legs;
  assert.equal(legs.length, 1);
  assert.equal(legs[0].selection, 'Verified 1 OVER 24.5 Points');

  const structured = rendered.slice(rendered.indexOf('```sgp'));
  assert.doesNotMatch(structured, /Player 2/);
  assert.doesNotMatch(structured, /\[PREDICTION_LOG\].*Player 2/s);
});

test('shortfall explains missing evidence and insufficient sample sizes instead of padding', () => {
  const rendered = renderScreenerSummaryBlocks(
    Array.from({ length: 3 }, (_, index) => researchCandidate(index)),
    5,
    { insufficientSamples: 4, minimumSample: 8 },
  );
  assert.match(rendered, /only 3 of 5 requested picks cleared the evidence floor/);
  assert.match(rendered, /4 player-markets were excluded for a sample below the 8-game minimum/);
  assert.match(rendered, /No picks were padded/);
});

test('NBA model minimum sample stays 8 for validated projections', () => {
  assert.equal(minimumSampleFor('nba'), 8);
});

test('a lookback window is not a requested pick count', () => {
  // Regression: "last 5 and 10 games" was read as a 10-pick request, which made
  // the all-or-nothing parlay gate reject a complete set of verified picks.
  const policy = parseParlayQualityPolicy(
    'Give me 5 NBA player-prop picks based on the last 5 and 10 games.',
  );
  assert.equal(policy.requestedMin, 5);
  assert.equal(policy.requestedMax, 5);

  const harness = renderScreenerSummaryBlocks(
    Array.from({ length: 5 }, (_, index) => verifiedCandidate(index)),
    5,
  );
  const legs = JSON.parse(/```sgp\s*([\s\S]*?)```/.exec(harness)![1]).legs;
  const finalized = finalizeStructuredParlay(legs, policy);
  assert.equal(finalized.complete, true, 'five verified picks must satisfy a five-pick request');
  assert.equal(finalized.legs.length, 5);
});

test('lookback stripping keeps genuine selection counts and other windows intact', () => {
  const cases: Array<[string, number | null, number | null]> = [
    ['Give me 5 NBA player props using L5 and L10 averages', 5, 5],
    ['Give me 5 NBA picks based on the last 10 games', 5, 5],
    ['Give me 5 NBA player props over the last five and ten games', 5, 5],
    ['Give me the best 5-6 game parlay', 5, 6],
    ['Build a five to six leg Same Game Parlay', 5, 6],
    ['Give me 5 NBA picks for a game projected 110-115 points', 5, 5],
    ['Give me the last 5 picks from my history', 5, 5],
    ['The score was 24-27; analyze the game', null, null],
  ];
  for (const [prompt, min, max] of cases) {
    const policy = parseParlayQualityPolicy(prompt);
    assert.equal(policy.requestedMin, min, prompt);
    assert.equal(policy.requestedMax, max, prompt);
  }
});

test('mixed prop + game-market requests keep the prop sample gate metadata', async () => {
  // Regression: the first `slate` payload (game market) has no sample fields,
  // so the prop screener's insufficient-sample detail was silently dropped.
  const originalFetch = globalThis.fetch;
  const keys = ['SPORTSGAMEODDS_API_KEY', 'SPORTSGAMEODDS_API_KEY_2', 'SHARPAPI_API_KEY'];
  const saved = keys.map((key) => process.env[key]);
  keys.forEach((key) => delete process.env[key]);

  const players = Array.from({ length: 4 }, (_, index) => ({
    id: `p${index + 1}`,
    displayName: `Player ${index + 1}`,
    position: { abbreviation: 'G' },
  }));
  // Only three games of history: every market fails the 8-game minimum, so the
  // shortfall must be attributed to the sample gate rather than left generic.
  const logEvents = Array.from({ length: 3 }, (_, index) => ({
    eventId: `e${index + 1}`,
    gameDate: `2026-11-0${index + 1}T00:00:00Z`,
    stats: ['34:12', '30', '8', '5', '3-8'],
  }));
  const gamelog = {
    names: ['minutes', 'points', 'totalRebounds', 'assists', 'threePointFieldGoalsMade-threePointFieldGoalsAttempted'],
    seasonTypes: [{
      displayName: 'Regular Season',
      categories: [{ events: logEvents.map((event) => ({ eventId: event.eventId, stats: event.stats })) }],
    }],
    events: Object.fromEntries(logEvents.map((event) => [
      event.eventId,
      { gameDate: event.gameDate, opponent: { displayName: 'New York Knicks' } },
    ])),
  };
  const scoreboard = {
    events: [{
      id: 'nba-1',
      date: '2026-11-08T17:00:00Z',
      status: { type: { name: 'STATUS_SCHEDULED', state: 'pre', completed: false } },
      competitions: [{
        competitors: [
          { homeAway: 'home', team: { id: '1', displayName: 'Boston Celtics' } },
          { homeAway: 'away', team: { id: '2', displayName: 'New York Knicks' } },
        ],
      }],
    }],
  };

  globalThis.fetch = (async (input: any) => {
    const url = String(input);
    if (url.includes('/scoreboard?dates=20261108')) return Response.json(scoreboard);
    if (url.includes('/teams/1/roster') || url.includes('/teams/2/roster')) return Response.json({ athletes: players });
    if (url.includes('/athletes/') && url.includes('/gamelog')) return Response.json(gamelog);
    if (url.includes('/summary?event=')) return Response.json({ pickcenter: [] });
    throw new Error('Unexpected endpoint: ' + url);
  }) as typeof fetch;

  try {
    const { FAST_SLATE_SCREENER_TOOL } = await import('../src/llm/fastSlateScreenerTool.js');
    const screened = await FAST_SLATE_SCREENER_TOOL.handler({ sport: 'nba', date: '2026-11-08', requestedPicks: 5 });
    if (!screened.available) {
      // No candidates at all is the expected outcome for a 3-game sample.
      assert.match(String(screened.reason), /enough recent-game history/);
      return;
    }
    const slate = (screened.payload as any).slate;
    assert.equal(slate.minimumSample, 8);
    assert.ok(slate.gates.insufficientSample > 0, 'sample gate must be accounted for');
    assert.equal(slate.priceProviderAvailable, false);
  } finally {
    globalThis.fetch = originalFetch;
    keys.forEach((key, index) => {
      if (saved[index] == null) delete process.env[key];
      else process.env[key] = saved[index];
    });
  }
});

test('shortfall names the exact gate that removed each candidate', () => {
  const rendered = renderScreenerSummaryBlocks(
    Array.from({ length: 2 }, (_, index) => researchCandidate(index)),
    5,
    {
      insufficientSamples: 4,
      minimumSample: 8,
      priceProviderAvailable: false,
      priceProviderReason: 'SHARPAPI_API_KEY not configured',
      gates: { noGameHistory: 2, insufficientSample: 4, modelUnavailable: 1, belowConfidence: 3, duplicatePlayer: 1 },
    },
  );
  assert.match(rendered, /2 player-markets had no usable recent game log/);
  assert.match(rendered, /4 player-markets were excluded for a sample below the 8-game minimum/);
  assert.match(rendered, /1 lacked a valid model probability/);
  assert.match(rendered, /3 scored below the confidence floor/);
  assert.match(rendered, /1 were dropped as a second market/);
  assert.match(rendered, /No live odds provider returned prices \(SHARPAPI_API_KEY not configured\)/);
});

test('research rationale never claims support for the opposite direction', async () => {
  const originalFetch = globalThis.fetch;
  const keys = ['SPORTSGAMEODDS_API_KEY', 'SPORTSGAMEODDS_API_KEY_2', 'SHARPAPI_API_KEY'];
  const saved = keys.map((key) => process.env[key]);
  keys.forEach((key) => delete process.env[key]);

  const players = [{ id: 'p1', displayName: 'Player 1', position: { abbreviation: 'G' } }];
  // 20 games averaging 2 made threes: the model's screened side at a 1.5 line
  // is over, so a projection above the threshold must be labeled as supporting
  // the displayed direction, never the inverse.
  const logEvents = Array.from({ length: 20 }, (_, index) => ({
    eventId: `e${index + 1}`,
    gameDate: `2026-10-${String(index + 1).padStart(2, '0')}T00:00:00Z`,
    stats: ['34:12', '2', '4', '2', '2-5'],
  }));
  const gamelog = {
    names: ['minutes', 'points', 'totalRebounds', 'assists', 'threePointFieldGoalsMade-threePointFieldGoalsAttempted'],
    seasonTypes: [{
      displayName: 'Regular Season',
      categories: [{ events: logEvents.map((event) => ({ eventId: event.eventId, stats: event.stats })) }],
    }],
    events: Object.fromEntries(logEvents.map((event) => [
      event.eventId,
      { gameDate: event.gameDate, opponent: { displayName: 'New York Knicks' } },
    ])),
  };
  const scoreboard = {
    events: [{
      id: 'nba-1',
      date: '2026-11-08T17:00:00Z',
      status: { type: { name: 'STATUS_SCHEDULED', state: 'pre', completed: false } },
      competitions: [{
        competitors: [
          { homeAway: 'home', team: { id: '1', displayName: 'Boston Celtics' } },
          { homeAway: 'away', team: { id: '2', displayName: 'New York Knicks' } },
        ],
      }],
    }],
  };

  globalThis.fetch = (async (input: any) => {
    const url = String(input);
    if (url.includes('/scoreboard?dates=20261108')) return Response.json(scoreboard);
    if (url.includes('/teams/1/roster') || url.includes('/teams/2/roster')) return Response.json({ athletes: players });
    if (url.includes('/athletes/') && url.includes('/gamelog')) return Response.json(gamelog);
    throw new Error('Unexpected endpoint: ' + url);
  }) as typeof fetch;

  try {
    const { FAST_SLATE_SCREENER_TOOL } = await import('../src/llm/fastSlateScreenerTool.js');
    const screened = await FAST_SLATE_SCREENER_TOOL.handler({
      sport: 'nba', date: '2026-11-08', requestedPicks: 5, market: 'threePointersMade',
    });
    assert.equal(screened.available, true);
    for (const candidate of (screened.payload as any).candidates) {
      if (candidate.recommendationType !== 'research' || !candidate.rationale) continue;
      const projection = Number(candidate.projection);
      const threshold = Number(candidate.historicalThreshold);
      const expectsSupport = candidate.side === 'over' ? projection > threshold : projection < threshold;
      assert.equal(
        /supports the (OVER|UNDER)/.test(candidate.rationale),
        expectsSupport,
        `${candidate.player} ${candidate.side} ${projection} vs ${threshold}: ${candidate.rationale}`,
      );
      if (/supports the/.test(candidate.rationale)) {
        assert.match(candidate.rationale, new RegExp(`supports the ${candidate.side.toUpperCase()}`));
      }
      if (/against the/.test(candidate.rationale)) {
        assert.match(candidate.rationale, new RegExp(`against the ${candidate.side.toUpperCase()}`));
      }
    }
  } finally {
    globalThis.fetch = originalFetch;
    keys.forEach((key, index) => {
      if (saved[index] == null) delete process.env[key];
      else process.env[key] = saved[index];
    });
  }
});

test('NBA statistical picks render when live odds providers are unavailable', async () => {
  const originalFetch = globalThis.fetch;
  const keys = ['SPORTSGAMEODDS_API_KEY', 'SPORTSGAMEODDS_API_KEY_2', 'SHARPAPI_API_KEY'];
  const saved = keys.map((key) => process.env[key]);
  keys.forEach((key) => delete process.env[key]);

  const players = Array.from({ length: 6 }, (_, index) => ({
    id: `p${index + 1}`,
    displayName: `Player ${index + 1}`,
    position: { abbreviation: 'G' },
  }));
  const logEvents = Array.from({ length: 10 }, (_, index) => ({
    eventId: `e${index + 1}`,
    gameDate: `2026-11-${String(index + 1).padStart(2, '0')}T00:00:00Z`,
    stats: ['34:12', '30', '8', '5', '3-8'],
  }));
  const gamelog = {
    names: ['minutes', 'points', 'totalRebounds', 'assists', 'threePointFieldGoalsMade-threePointFieldGoalsAttempted'],
    seasonTypes: [{
      displayName: 'Regular Season',
      categories: [{ events: logEvents.map((event) => ({ eventId: event.eventId, stats: event.stats })) }],
    }],
    events: Object.fromEntries(logEvents.map((event) => [
      event.eventId,
      { gameDate: event.gameDate, opponent: { displayName: 'New York Knicks' } },
    ])),
  };
  const scoreboard = {
    events: [{
      id: 'nba-1',
      date: '2026-11-07T17:00:00Z',
      status: { type: { name: 'STATUS_SCHEDULED' } },
      competitions: [{
        competitors: [
          { homeAway: 'home', team: { id: '1', displayName: 'Boston Celtics' } },
          { homeAway: 'away', team: { id: '2', displayName: 'New York Knicks' } },
        ],
      }],
    }],
  };

  const urls: string[] = [];
  globalThis.fetch = (async (input: any) => {
    const url = String(input);
    urls.push(url);
    if (url.includes('/scoreboard?dates=20261107')) return Response.json(scoreboard);
    if (url.includes('/teams/1/roster') || url.includes('/teams/2/roster')) return Response.json({ athletes: players });
    if (url.includes('/athletes/') && url.includes('/gamelog')) return Response.json(gamelog);
    throw new Error('Unexpected endpoint: ' + url);
  }) as typeof fetch;

  try {
    const result = await runAgent(
      { configured: false, provider: 'none', model: '', models: [], baseUrl: '' },
      [{ role: 'user', content: 'Best NBA props 2026-11-07' }],
      [],
    );

    assert.match(result.content, /Research-only statistical picks — NOT verified sportsbook lines/);
    assert.match(result.content, /L5 30/);
    assert.match(result.content, /L10 30/);
    assert.match(result.content, /historical threshold 29\.5 \(NOT a sportsbook line\)/);
    assert.match(result.content, /data through 2026-11-10/);
    assert.doesNotMatch(result.content, /```sgp/);
    assert.doesNotMatch(result.content, /\[PREDICTION_LOG\]/);
    assert.doesNotMatch(result.content, /No verified candidates found/);
    assert.equal(urls.some((url) => url.includes('sharpapi')), false);
    assert.equal(urls.some((url) => url.includes('sportsgameodds')), false);
  } finally {
    globalThis.fetch = originalFetch;
    keys.forEach((key, index) => {
      if (saved[index] == null) delete process.env[key];
      else process.env[key] = saved[index];
    });
  }
});

test('configured-but-failing odds providers fall back to research picks without leaking credentials', async () => {
  const keys = ['SPORTSGAMEODDS_API_KEY', 'SPORTSGAMEODDS_API_KEY_2', 'SHARPAPI_API_KEY'];
  const saved = keys.map((key) => process.env[key]);
  const secrets = ['fixture-secret-a', 'fixture-secret-b', 'fixture-secret-c'];
  process.env.SPORTSGAMEODDS_API_KEY = secrets[0];
  process.env.SPORTSGAMEODDS_API_KEY_2 = secrets[1];
  process.env.SHARPAPI_API_KEY = secrets[2];

  const originalFetch = globalThis.fetch;
  const providerUrls: string[] = [];
  const providerHeaders: string[] = [];
  const players = Array.from({ length: 6 }, (_, index) => ({
    id: `p${index + 1}`, displayName: `Player ${index + 1}`, position: { abbreviation: 'G' },
  }));
  const logEvents = Array.from({ length: 10 }, (_, index) => ({
    eventId: `e${index + 1}`,
    gameDate: `2026-11-${String(index + 1).padStart(2, '0')}T00:00:00Z`,
    stats: ['34:12', '30', '8', '5', '3-8'],
  }));
  const gamelog = {
    names: ['minutes', 'points', 'totalRebounds', 'assists', 'threePointFieldGoalsMade-threePointFieldGoalsAttempted'],
    seasonTypes: [{
      displayName: 'Regular Season',
      categories: [{ events: logEvents.map((event) => ({ eventId: event.eventId, stats: event.stats })) }],
    }],
    events: Object.fromEntries(logEvents.map((event) => [
      event.eventId,
      { gameDate: event.gameDate, opponent: { displayName: 'New York Knicks' } },
    ])),
  };
  const scoreboard = {
    events: [{
      id: 'nba-1',
      date: '2026-11-08T17:00:00Z',
      status: { type: { name: 'STATUS_SCHEDULED', state: 'pre', completed: false } },
      competitions: [{
        competitors: [
          { homeAway: 'home', team: { id: '1', displayName: 'Boston Celtics' } },
          { homeAway: 'away', team: { id: '2', displayName: 'New York Knicks' } },
        ],
      }],
    }],
  };

  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input);
    if (url.includes('sportsgameodds') || url.includes('sharpapi')) {
      providerUrls.push(url);
      const headers = new Headers(init?.headers);
      providerHeaders.push(`${headers.get('x-api-key') ?? ''}|${headers.get('X-API-Key') ?? ''}`);
      // Unauthorized: quota/credential failures must fail closed, never invent.
      return new Response('{"error":"unauthorized"}', { status: 401, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('/scoreboard?dates=20261108')) return Response.json(scoreboard);
    if (url.includes('/teams/1/roster') || url.includes('/teams/2/roster')) return Response.json({ athletes: players });
    if (url.includes('/teams')) return Response.json({ sports: [{ leagues: [{ teams: [] }] }] });
    if (url.includes('/athletes/') && url.includes('/gamelog')) return Response.json(gamelog);
    if (url.includes('/injuries')) return Response.json({ injuries: [] });
    throw new Error('Unexpected upstream: ' + url);
  }) as typeof fetch;

  try {
    const slates: any[] = [];
    const warnings: string[] = [];
    const result = await runAgent(
      { configured: false, provider: 'none', model: '', models: [], baseUrl: '' },
      [{ role: 'user', content: 'Give me 5 NBA player-prop picks for 2026-11-08 based on the last 5 and 10 games.' }],
      getToolSchemas(),
      { onToolEvent: (event) => {
        if (event.status === 'done' && event.data?.slate) {
          slates.push(event.data.slate);
          warnings.push(String(event.data.warning ?? ''));
        }
      } },
    );

    assert.ok(providerUrls.length > 0, 'the configured providers must actually be attempted');
    // The key belongs in a server-side header, never in a URL or the payload.
    assert.equal(providerUrls.some((url) => secrets.some((secret) => url.includes(secret))), false);
    assert.equal(providerHeaders.some((header) => secrets.some((secret) => header.includes(secret))), true);
    assert.equal(secrets.some((secret) => result.content.includes(secret)), false);

    assert.equal(slates[0].priceProviderAvailable, false);
    assert.equal(slates[0].verifiedCandidates, 0);
    assert.ok(slates[0].researchCandidates > 0);
    // NBA has no batting order; the warning must describe lineups, not MLB orders.
    assert.match(warnings[0], /^Starting lineups have NOT been posted/);
    assert.doesNotMatch(warnings[0], /Batting orders/);
    assert.match(result.content, /Research-only statistical picks/);
    assert.doesNotMatch(result.content, /[+-]\d{3}\b/, 'unauthorized providers must not yield invented odds');
  } finally {
    globalThis.fetch = originalFetch;
    keys.forEach((key, index) => {
      if (saved[index] == null) delete process.env[key];
      else process.env[key] = saved[index];
    });
  }
});

test('only priced rows and NBA research props survive display selection', () => {
  const nowIso = new Date().toISOString();
  const priced = {
    sport: 'nfl', player: 'Priced Receiver', eventId: 'nfl-1', eventDate: '2026-11-08',
    market: 'receivingYards', side: 'over', marketLine: 59.5, marketOddsOver: -110,
    marketSource: 'api.sportsgameodds.com', marketCheckedAt: nowIso, confidencePct: 62,
  };
  const unpricedNfl = {
    sport: 'nfl', player: 'Unpriced Receiver', eventId: 'nfl-2', eventDate: '2026-11-08',
    market: 'receivingYards', side: 'over', marketLine: null, marketOddsOver: null,
    marketSource: null, marketCheckedAt: null, confidencePct: 62,
  };
  const unpricedNba = {
    sport: 'nba', player: 'Research Guard', eventId: 'nba-3', eventDate: '2026-11-08',
    market: 'points', side: 'over', marketLine: null, marketOddsOver: null,
    marketSource: null, marketCheckedAt: null, confidencePct: 64,
    recommendationType: 'research', researchOnly: true,
  };
  const unpricedGame = {
    candidateType: 'game_market', sport: 'nfl', team: 'Buffalo Bills', eventId: 'nfl-4',
    eventDate: '2026-11-08', market: 'moneyline', marketOdds: null, confidencePct: 60,
  };

  const kept = selectDisplayableCandidates([priced, unpricedNfl, unpricedNba, unpricedGame]);
  assert.deepEqual(kept.map((row) => row.player ?? row.team), ['Priced Receiver', 'Research Guard']);
});

test('research picks reach the SSE client under strict evidence gating', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'se-nba-research-sse-'));
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
  // Strict mode previously withheld any non-structured recommendation prose;
  // explicitly labeled research picks must survive it.
  process.env.EVIDENCE_GATE = 'strict';
  for (const key of [
    'VERCEL', 'VERCEL_ENV', 'AUTH_ADMIN_PASSWORD_HASH',
    'SPORTSGAMEODDS_API_KEY', 'SPORTSGAMEODDS_API_KEY_2', 'SHARPAPI_API_KEY',
    'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN',
    'GROQ_API_KEY', 'GEMINI_API_KEY', 'OPENROUTER_API_KEY', 'OPENCODE_ZEN_API_KEY',
  ]) delete process.env[key];

  const players = Array.from({ length: 6 }, (_, index) => ({
    id: `p${index + 1}`,
    displayName: `Fixture Player ${index + 1}`,
    position: { abbreviation: 'G' },
  }));
  const logEvents = Array.from({ length: 10 }, (_, index) => ({
    eventId: `e${index + 1}`,
    gameDate: `2026-11-${String(index + 1).padStart(2, '0')}T00:00:00Z`,
    stats: ['34:12', '30', '8', '5', '3-8'],
  }));
  const gamelog = {
    names: ['minutes', 'points', 'totalRebounds', 'assists', 'threePointFieldGoalsMade-threePointFieldGoalsAttempted'],
    seasonTypes: [{
      displayName: 'Regular Season',
      categories: [{ events: logEvents.map((event) => ({ eventId: event.eventId, stats: event.stats })) }],
    }],
    events: Object.fromEntries(logEvents.map((event) => [
      event.eventId,
      { gameDate: event.gameDate, opponent: { displayName: 'New York Knicks' } },
    ])),
  };
  const scoreboard = {
    events: [{
      id: 'nba-1',
      date: '2026-11-08T17:00:00Z',
      status: { type: { name: 'STATUS_SCHEDULED', state: 'pre', completed: false } },
      competitions: [{
        competitors: [
          { homeAway: 'home', team: { id: '1', displayName: 'Boston Celtics' } },
          { homeAway: 'away', team: { id: '2', displayName: 'New York Knicks' } },
        ],
      }],
    }],
  };
  globalThis.fetch = (async (input: any, options?: any) => {
    const url = String(input);
    if (url.startsWith('http://127.0.0.1:')) return originalFetch(input, options);
    if (url.includes('/scoreboard?dates=20261108')) return Response.json(scoreboard);
    if (url.includes('/teams/1/roster') || url.includes('/teams/2/roster')) return Response.json({ athletes: players });
    if (url.includes('/teams')) return Response.json({ sports: [{ leagues: [{ teams: [] }] }] });
    if (url.includes('/athletes/') && url.includes('/gamelog')) return Response.json(gamelog);
    if (url.includes('/injuries')) return Response.json({ injuries: [] });
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

    const response = await fetch(base + '/api/chat', {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        sport: 'NBA',
        messages: [{ role: 'user', content: 'Give me 5 NBA player-prop picks for 2026-11-08 based on the last 5 and 10 games.' }],
      }),
    });
    assert.equal(response.status, 200);
    const stream = await response.text();

    assert.match(stream, /event: done/, 'the stream must terminate cleanly');
    assert.doesNotMatch(stream, /event: error/);
    // No LLM key is configured in this test; the SSE metadata must not claim one.
    const meta = JSON.parse([...stream.matchAll(/^event: meta\ndata: (.*)$/gm)][0][1]);
    assert.equal(meta.llmConfigured, false);
    assert.doesNotMatch(stream, /Recommendation withheld/);
    assert.doesNotMatch(stream, /No LLM API key configured/);

    const delta = [...stream.matchAll(/^event: delta\ndata: (.*)$/gm)]
      .map((match) => JSON.parse(match[1]).text).join('');
    assert.match(delta, /Research-only statistical picks — NOT verified sportsbook lines/);
    assert.match(delta, /historical threshold 29\.5 \(NOT a sportsbook line\)/);
    assert.match(delta, /L5 30/);
    assert.match(delta, /L10 30/);
    assert.match(delta, /data through 2026-11-10/);
    // Research picks must not leak into the slip or the learning ledger.
    assert.doesNotMatch(stream, /event: sgp/);
    assert.doesNotMatch(stream, /\[PREDICTION_LOG\]/);
    // No fabricated sportsbook price, implied probability or EV for research rows.
    // The disclaimer itself only states that none are shown, so assert on values.
    assert.doesNotMatch(delta, /[+-]\d{3}\b/, 'research picks must not print American odds');
    assert.doesNotMatch(delta, /\bEV\b\s*[:+-]?\s*\d/i, 'research picks must not print an EV value');
    assert.doesNotMatch(delta, /implied probability\s*[:=]?\s*\d/i, 'research picks must not print implied probability');
    assert.doesNotMatch(delta, /\bGrade [A-D]\b/);
  } finally {
    globalThis.fetch = originalFetch;
    if (server) await new Promise<void>((resolve, reject) => server.close((error: any) => error ? reject(error) : resolve()));
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
    Object.assign(process.env, env);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
