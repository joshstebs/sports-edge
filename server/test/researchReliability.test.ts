import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildResearchForm,
  currentSeasonStartYear,
  priorSeasonParam,
  researchGameRows,
  seasonLabelMatches,
  usageFromStats,
} from '../src/llm/fastSlateScreenerTool.js';
import {
  espnObservation,
  isRealisticLine,
  normalizeMarket,
  snapToRealisticLine,
} from '../src/models/playerPropModel.js';
import { propLineIntegrity } from '../src/models/propLineIntegrity.js';

function history(games: any[], base = games) {
  return {
    mode: 'espn' as const,
    source: 'fixture',
    season: {},
    games: base,
    currentGames: games,
    priorGames: base === games ? null : base,
    usedPriorSeason: base !== games,
  };
}

test('NBA DNP rows with zero minutes never count as played games', () => {
  const games = [
    { gameId: 'g1', gameDate: '2026-11-01', stats: { minutes: '0:00', points: '20' } },
    { gameId: 'g2', gameDate: '2026-11-02', stats: { minutes: '34:12', points: '18' } },
    { gameId: 'g3', gameDate: '2026-11-03', stats: { minutes: '0', points: '12' } },
  ];
  const rows = researchGameRows(history(games) as any, 'nba', 'points');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].value, 18);
  assert.equal(rows[0].minutes, 34.2);
});

test('current-season L5/L10 excludes prior-season context even when the model uses it', () => {
  const current = Array.from({ length: 4 }, (_, index) => ({
    gameId: `c${index + 1}`,
    gameDate: `2026-10-0${index + 1}`,
    stats: { receivingYards: String(10 + index), receivingTargets: '8' },
  }));
  const prior = Array.from({ length: 10 }, (_, index) => ({
    gameId: `p${index + 1}`,
    gameDate: `2025-10-${String(index + 1).padStart(2, '0')}`,
    stats: { receivingYards: '50', receivingTargets: '8' },
  }));
  const merged = [...current, ...prior];
  const rows = researchGameRows(history(current, merged) as any, 'nfl', 'receivingYards');
  assert.equal(rows.length, 4, 'displayed form must stay current-season only');
  assert.deepEqual(rows.map((row) => row.value), [10, 11, 12, 13]);

  const form = buildResearchForm({
    values: rows.map((row) => row.value),
    usage: rows.map((row) => row.usage),
    threshold: 11.5,
    side: 'over',
    priorValues: prior.map((game) => Number(game.stats.receivingYards)),
    priorSeasonLabel: '2025',
  });
  assert.equal(form.l5Average, 11.5);
  assert.equal(form.l10Average, 11.5);
  assert.equal(form.seasonSampleSize, 4);
  assert.equal(form.priorSeasonSampleSize, 10);
  assert.equal(form.priorSeasonAverage, 50);
  assert.equal(form.priorSeasonLabel, '2025');
});

test('push rows are excluded from the research hit-rate denominator', () => {
  const form = buildResearchForm({
    values: [30, 27.5, 25, 29, 27.5],
    threshold: 27.5,
    side: 'over',
  });
  assert.equal(form.wins, 2);
  assert.equal(form.pushes, 2);
  assert.equal(form.losses, 1);
  assert.equal(form.hitFrequency, 2 / 3);
});

test('research form exposes trend, usage and an uncertainty range without inventing values', () => {
  const form = buildResearchForm({
    values: [30, 28, 26, 24, 22, 20],
    usage: [8, 8, 7, 7, 6, 6],
    threshold: 25,
    side: 'over',
  });
  assert.equal(form.l5Average, 26);
  assert.equal(form.l10Average, 25);
  assert.equal(form.seasonAverage, 25);
  assert.equal(form.trend, 1);
  assert.equal(form.usageL5, 7.2);
  assert.equal(form.projection, 25.5);
  assert.ok(form.projectionLow != null && form.projectionHigh != null);
  assert.ok(form.projectionLow! < form.projection! && form.projectionHigh! > form.projection!);
});

test('NFL markets expose rushing attempts and anytime TD without cross-market leakage', () => {
  assert.equal(normalizeMarket('rushingAttempts'), 'rushingAttempts');
  assert.equal(normalizeMarket('carries'), 'rushingAttempts');
  assert.equal(normalizeMarket('anytime touchdown'), 'touchdowns');
  assert.equal(espnObservation('nfl', 'rushingAttempts', { rushingAttempts: '12' }), 12);
  assert.equal(espnObservation('nfl', 'touchdowns', {
    rushingTouchdowns: '1', receivingTouchdowns: '1', passingTouchdowns: '3',
  }), 2, 'anytime TD excludes passing touchdowns');
  assert.equal(usageFromStats('nfl', 'rushingYards', { rushingAttempts: '12', receivingTargets: '2' }), 14);
  assert.equal(usageFromStats('nfl', 'passingYards', { passingAttempts: '33' }), 33);
  assert.equal(usageFromStats('nfl', 'receivingYards', { receivingTargets: '7' }), 7);
  assert.equal(usageFromStats('nfl', 'receivingYards', {}), null);
});

test('new NFL market lines pass integrity and snap to real ladders', () => {
  assert.equal(isRealisticLine('nfl', 'rushingAttempts', 11.5), true);
  assert.equal(isRealisticLine('nfl', 'touchdowns', 0.5), true);
  assert.equal(propLineIntegrity('nfl', 'rushingAttempts', 11.5).valid, true);
  assert.equal(propLineIntegrity('nfl', 'rushingAttempts', 11.2).valid, false);
  assert.equal(propLineIntegrity('nfl', 'touchdowns', 0.5).valid, true);
  assert.equal(propLineIntegrity('nfl', 'passingTouchdowns', 2.5).valid, true);
  assert.equal(snapToRealisticLine('nfl', 'rushingAttempts', 12.5), 11.5);
  assert.equal(snapToRealisticLine('nfl', 'touchdowns', 1.5), 0.5);
  assert.equal(snapToRealisticLine('nfl', 'passingTouchdowns', 2.1), 2.5);
});

test('season boundaries distinguish current from stale two-year labels', () => {
  const nbaNovember = new Date('2026-11-08T12:00:00Z');
  const nbaJanuary = new Date('2027-01-15T12:00:00Z');
  const nflJanuary = new Date('2027-01-15T12:00:00Z');
  assert.equal(currentSeasonStartYear('nba', nbaNovember), 2026);
  assert.equal(currentSeasonStartYear('nba', nbaJanuary), 2026);
  assert.equal(currentSeasonStartYear('nfl', nflJanuary), 2026);
  assert.equal(seasonLabelMatches('nba', '2026-27 Regular Season', nbaNovember), true);
  assert.equal(seasonLabelMatches('nba', '2025-26 Regular Season', nbaNovember), false);
  assert.equal(seasonLabelMatches('nhl', '2026-27 Regular Season', nbaNovember), true);
  assert.equal(seasonLabelMatches('nfl', '2026 Regular Season', nflJanuary), true);
  assert.equal(seasonLabelMatches('nfl', '2025 Regular Season', nflJanuary), false);
  // Unlabeled legacy payloads remain accepted rather than silently dropping data.
  assert.equal(seasonLabelMatches('nba', 'Regular Season', nbaNovember), true);
  assert.equal(priorSeasonParam('nba', nbaNovember), 2026);
  assert.equal(priorSeasonParam('nfl', nbaNovember), 2025);
});
