import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProplineOdds, proplineMarketsFor, PROPLINE_MARKETS } from '../src/providers/propline.js';
import { isLineNearProjection, isRealisticLine } from '../src/models/playerPropModel.js';
import { orderRosterForSampling, interleaveByPosition } from '../src/providers/slateDiscovery.js';
import { isBlockingInjuryStatus, blockingInjuries } from '../src/models/injuryStatus.js';
import { canonicalPropMarket, isPlausiblePropLine } from '../src/models/propLineIntegrity.js';

function outcome(description: string, name: 'Over' | 'Under', price: number, point: number) {
  return { description, name, price, point };
}

function market(key: string, outcomes: any[]) {
  return { key, outcomes };
}

const nbaPayload = [
  {
    id: '1', home_team: 'Home', away_team: 'Away', last_update: '2026-11-09T18:00:00Z',
    bookmakers: [
      { key: 'draftkings', markets: [market('player_points', [
        outcome('Test Player', 'Over', -110, 20.5), outcome('Test Player', 'Under', -110, 20.5),
        outcome('Test Player', 'Over', 200, 24.5), outcome('Test Player', 'Under', -250, 24.5),
      ])] },
      { key: 'fanduel', markets: [market('player_points', [
        outcome('Test Player', 'Over', -105, 20.5), outcome('Test Player', 'Under', -115, 20.5),
      ])] },
      { key: 'bovada', markets: [market('player_points', [
        outcome('Test Player', 'Over', 999, 99.5), outcome('Test Player', 'Under', -999, 99.5),
      ])] },
    ],
  },
];

test('PropLine parsing keeps the consensus line and never the outliers', () => {
  const parsed = parseProplineOdds(nbaPayload, 'nba');
  assert.equal(parsed.available, true);
  const quote = parsed.byKey.get('test player|points');
  assert.ok(quote);
  assert.equal(quote!.line, 20.5, 'line quoted by two books wins over a one-book line');
  assert.equal(quote!.bookCount, 2);
  assert.equal(quote!.over, -105, 'best price for the side is kept');
  assert.equal(quote!.under, -110);
  assert.equal(quote!.source, 'api.prop-line.com');
  const alternates = parsed.alternatesByKey.get('test player|points');
  assert.ok(alternates?.some((row) => row.line === 24.5));
  assert.ok(alternates?.some((row) => row.line === 99.5));
});

test('PropLine parsing drops unsupported markets and implausible lines', () => {
  const payload = [{ bookmakers: [{ key: 'draftkings', markets: [
    market('player_unicorn_stat', [outcome('Somebody', 'Over', -110, 1.5)]),
    market('player_points', [outcome('Outlier', 'Over', -110, 5000.5), outcome('Outlier', 'Under', -110, 5000.5)]),
    market('player_points', [outcome('', 'Over', -110, 10.5)]),
  ] }] }];
  const parsed = parseProplineOdds(payload, 'nba');
  assert.equal(parsed.available, false);
  assert.equal(parsed.byKey.size, 0);
});

test('PropLine parsing reports unavailable on an empty payload', () => {
  const parsed = parseProplineOdds([], 'nba');
  assert.equal(parsed.available, false);
  assert.match(parsed.reason ?? '', /no events/i);
});

test('PropLine market map covers the markets the NBA/NFL screeners request', () => {
  const nba = proplineMarketsFor('nba');
  const nfl = proplineMarketsFor('nfl');
  for (const key of ['player_points', 'player_rebounds', 'player_assists', 'player_threes']) {
    assert.ok(nba.includes(key), `${key} must be requested from PropLine`);
  }
  for (const key of ['player_pass_yds', 'player_rush_yds', 'player_reception_yds', 'player_receptions']) {
    assert.ok(nfl.includes(key), `${key} must be requested from PropLine`);
  }
  assert.equal(PROPLINE_MARKETS.nfl.player_reception_yds, 'receivingYards');
});

test('a snapped line far from the projection is rejected, a close one is kept', () => {
  assert.equal(isLineNearProjection(2.1, 3.5), false, '2.1 RPG must not become an easy under 3.5');
  assert.equal(isLineNearProjection(4.0, 3.5), true);
  assert.equal(isLineNearProjection(20.0, 19.5), true);
  assert.equal(isLineNearProjection(null, 3.5), true, 'unknown projection keeps the legacy behaviour');
  assert.equal(isRealisticLine('nba', 'rebounds', 3.5), true);
});

test('NBA roster sampling prefers production ranks over alphabetical order', () => {
  const roster = [
    { id: '1', name: 'Aaron Aardvark', position: 'G' },
    { id: '2', name: 'Zion Zebra', position: 'F' },
    { id: '3', name: 'Middle Man', position: 'C' },
  ];
  const ranks = new Map([['2', 0], ['3', 4]]);
  const ordered = orderRosterForSampling(roster, ranks);
  assert.deepEqual(ordered.map((row) => row.id), ['2', '3', '1']);
});

test('NFL roster sampling interleaves positions instead of slicing one group', () => {
  const roster = [
    { id: 'q1', name: 'QB One', position: 'QB' },
    { id: 'q2', name: 'QB Two', position: 'QB' },
    { id: 'q3', name: 'QB Three', position: 'QB' },
    { id: 'r1', name: 'RB One', position: 'RB' },
    { id: 'w1', name: 'WR One', position: 'WR' },
    { id: 't1', name: 'TE One', position: 'TE' },
  ];
  const ordered = interleaveByPosition(roster).map((row) => row.id);
  assert.deepEqual(ordered.slice(0, 4), ['q1', 'r1', 'w1', 't1'], 'one of each role before a second QB');
  assert.equal(ordered.length, roster.length);
});




test('benign "Active" injury rows do not block; real designations do', () => {
  assert.equal(isBlockingInjuryStatus('Active'), false);
  assert.equal(isBlockingInjuryStatus('Probable'), false);
  assert.equal(isBlockingInjuryStatus(''), false);
  assert.equal(isBlockingInjuryStatus('Questionable'), true);
  assert.equal(isBlockingInjuryStatus('Day-To-Day'), true);
  assert.equal(isBlockingInjuryStatus('Out'), true);
  assert.equal(isBlockingInjuryStatus('Injured Reserve'), true);
  assert.equal(isBlockingInjuryStatus('Suspended'), true);

  const rows = [
    { playerName: 'Healthy Starter', status: 'Active' },
    { playerName: 'Hurt Starter', status: 'Questionable' },
    { playerName: 'No Status' },
  ];
  assert.deepEqual(blockingInjuries(rows).map((row) => row.playerName), ['Hurt Starter']);
});

test('provider market keys canonicalize into the model vocabulary', () => {
  assert.equal(canonicalPropMarket('player_points', 'nba'), 'points');
  assert.equal(canonicalPropMarket('player_rebounds', 'nba'), 'rebounds');
  assert.equal(canonicalPropMarket('player_assists', 'nba'), 'assists');
  assert.equal(canonicalPropMarket('player_threes', 'nba'), 'threePointersMade');
  assert.equal(canonicalPropMarket('player_points_rebounds_assists', 'nba'), 'pointsReboundsAssists');
  assert.equal(canonicalPropMarket('player_pass_yds', 'nfl'), 'passingYards');
  assert.equal(canonicalPropMarket('player_reception_yds', 'nfl'), 'receivingYards');
  assert.equal(canonicalPropMarket('player_receptions', 'nfl'), 'receptions');
  assert.equal(canonicalPropMarket('player_anytime_td', 'nfl'), 'touchdowns');
  assert.equal(canonicalPropMarket('player_goals', 'nhl'), 'goals');
  assert.equal(isPlausiblePropLine('nba', 'player_points', 24.5), true);
  assert.equal(isPlausiblePropLine('nfl', 'player_reception_yds', 39.5), true);
  // Model-supported markets the integrity gate used to reject outright.
  assert.equal(isPlausiblePropLine('mlb', 'earnedRuns', 2.5), true);
  assert.equal(isPlausiblePropLine('nba', 'steals', 1.5), true);
});
