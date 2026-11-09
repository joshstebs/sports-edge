import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MIN_SAMPLE,
  buildPlayerPropModel,
  espnObservation,
  minimumSampleFor,
  type HistoricalObservation,
} from '../src/models/playerPropModel.js';
import {
  mergeSeasonGames,
  needsPriorSeasonFallback,
  priorSeasonFallbackThreshold,
} from '../src/llm/fastSlateScreenerTool.js';

interface FixtureGame {
  gameId: string;
  gameDate: string;
  stats: Record<string, string>;
}

function seasonGames(prefix: string, count: number, points = 20, year = 2026): FixtureGame[] {
  return Array.from({ length: count }, (_, index) => ({
    gameId: `${prefix}-${index + 1}`,
    gameDate: `${year}-10-${String(index + 1).padStart(2, '0')}T00:00:00Z`,
    stats: { points: String(points) },
  }));
}

function nbaObservations(games: FixtureGame[]): HistoricalObservation[] {
  return games.map((game) => {
    const value = espnObservation('nba', 'points', game.stats);
    assert.equal(typeof value, 'number');
    return { value: value as number };
  });
}

function nbaModel(games: FixtureGame[]) {
  return buildPlayerPropModel({
    sport: 'nba',
    market: 'points',
    side: 'over',
    line: 19.5,
    observations: nbaObservations(games),
    source: 'official test fixture',
  });
}

test('NBA sample floor is the shared model minimum, not the legacy 5-game gate', () => {
  assert.equal(MIN_SAMPLE.nba, 8);
  assert.equal(minimumSampleFor('nba'), 8);
  assert.equal(priorSeasonFallbackThreshold('nba'), 8);
  assert.equal(needsPriorSeasonFallback('nba', 4), true);
  assert.equal(needsPriorSeasonFallback('nba', 5), true);
  assert.equal(needsPriorSeasonFallback('nba', 7), true);
  assert.equal(needsPriorSeasonFallback('nba', 8), false);
});

test('NBA logs with 4, 5 or 7 current-season games stay unavailable without prior-season data', () => {
  for (const count of [4, 5, 7]) {
    const current = seasonGames('current', count);
    const merged = mergeSeasonGames(current, null);
    assert.equal(merged.usedPriorSeason, false);
    assert.equal(merged.games.length, count);

    const model = nbaModel(merged.games);
    assert.equal(model.available, false, `${count} games must be below the 8-game model minimum`);
    assert.equal(model.sampleSize, count);
  }

  const healthy = mergeSeasonGames(seasonGames('current', 8), null);
  assert.equal(needsPriorSeasonFallback('nba', healthy.games.length), false);
  const model = nbaModel(healthy.games);
  assert.equal(model.available, true);
  assert.equal(model.sampleSize, 8);
});

test('available prior-season data tops up short NBA logs to the 8-game model floor', () => {
  const cases: Array<{ current: number; prior: number; expected: number }> = [
    { current: 4, prior: 4, expected: 8 },
    { current: 4, prior: 20, expected: 20 },
    { current: 5, prior: 3, expected: 8 },
    { current: 7, prior: 1, expected: 8 },
    { current: 7, prior: 10, expected: 17 },
  ];

  for (const { current, prior, expected } of cases) {
    const currentGames = seasonGames('current', current, 20, 2026);
    const priorGames = seasonGames('prior', prior, 22, 2025);
    assert.equal(needsPriorSeasonFallback('nba', currentGames.length), true);

    const merged = mergeSeasonGames(currentGames, priorGames);
    assert.equal(merged.usedPriorSeason, true);
    assert.equal(merged.games.length, Math.min(20, expected));

    const model = nbaModel(merged.games);
    assert.equal(
      model.available,
      true,
      `${current} current + ${prior} prior games must satisfy the model minimum`,
    );
    assert.equal(model.sampleSize, Math.min(20, expected));
  }
});

test('regression: a 7-game NBA log is topped up instead of silently rejected', () => {
  const current = seasonGames('current', 7);
  assert.equal(needsPriorSeasonFallback('nba', current.length), true);
  assert.equal(nbaModel(mergeSeasonGames(current, null).games).available, false);

  const merged = mergeSeasonGames(current, seasonGames('prior', 1));
  assert.equal(merged.games.length, 8);
  assert.equal(merged.usedPriorSeason, true);
  assert.equal(nbaModel(merged.games).available, true);
});

test('merging keeps current-season rows first, dedupes game IDs and caps at 20', () => {
  const current = seasonGames('current', 4);
  const duplicate = { ...current[0], stats: { points: '99' } };
  const prior = [duplicate, ...seasonGames('prior', 20)];

  const merged = mergeSeasonGames(current, prior);
  assert.equal(merged.games[0].gameId, 'current-1');
  assert.equal(merged.games.filter((game) => game.gameId === 'current-1').length, 1);
  assert.equal(merged.games.length, 20);
  assert.equal(merged.usedPriorSeason, true);
});

test('other sports keep their existing fallback thresholds and model minimums', () => {
  // NFL's model minimum was already 5, so its fallback trigger does not move.
  assert.equal(minimumSampleFor('nfl'), 5);
  assert.equal(priorSeasonFallbackThreshold('nfl'), 5);
  assert.equal(needsPriorSeasonFallback('nfl', 4), true);
  assert.equal(needsPriorSeasonFallback('nfl', 5), false);

  // MLB uses the statsapi path; NHL keeps its historical fallback trigger.
  assert.equal(minimumSampleFor('mlb'), 8);
  assert.equal(priorSeasonFallbackThreshold('mlb'), 5);
  assert.equal(minimumSampleFor('nhl'), 8);
  assert.equal(priorSeasonFallbackThreshold('nhl'), 5);
  assert.equal(needsPriorSeasonFallback('nhl', 7), false);
});
