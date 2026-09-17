import assert from 'node:assert/strict';
import test from 'node:test';
import { findBestLine, type OddsMarket } from '../src/providers/oddsAggregator.js';
import { renderScreenerSummaryBlocks } from '../src/llm/screenerRenderer.js';
import { inferScreenerIntent } from '../src/llm/chatClient.js';
import { getToolSchemas } from '../src/llm/toolRegistry.js';

function row(line: number, odds: number, book: string): OddsMarket {
  return { market: 'player_total_bases', side: 'over', line, odds, book, lastUpdated: '2026-09-06T12:00:00Z' };
}

test('consensus line beats a one-book alternate line', () => {
  const markets = [
    row(1.5, -115, 'A'),
    row(1.5, -105, 'B'),
    row(1.5, -110, 'C'),
    row(2.5, 145, 'D'),
  ];
  const best = findBestLine(markets, 'player_total_bases', 'over');
  assert.equal(best?.line, 1.5);
  assert.equal(best?.book, 'B');
  assert.equal(best?.odds, -105);
});

test('fast screener renderer uses live primary line and emits prediction log', () => {
  const text = renderScreenerSummaryBlocks([{
    player: 'Example Player', team: 'Away', opponent: 'Home', sport: 'mlb',
    eventDate: '2026-09-06', eventId: 123, market: 'totalBases', side: 'over',
    suggestedLine: 2.5, marketLine: 1.5, marketOddsOver: -110, marketOddsUnder: -120,
    lineLabel: 'PRIMARY / CONSENSUS LINE', alternateLines: [{ line: 2.5 }],
    confidencePct: 61, grade: 'B', sampleSize: 20, modelVersion: 'empirical-beta-v1',
    source: 'statsapi.mlb.com', inLineupToday: true,
  }], 1);
  assert.match(text, /total Bases OVER 1\.5/i);
  assert.match(text, /PRIMARY \/ CONSENSUS LINE/);
  assert.match(text, /Alternate lines available but deprioritized: 2\.5/);
  assert.match(text, /\`\`\`sgp/);
  assert.match(text, /\[PREDICTION_LOG\]/);
  assert.match(text, /"implied_odds":-110/);
  assert.match(text, /"line_verified":true/);
  assert.match(text, /"line_checked_at":"/);
  assert.doesNotMatch(text, /OVER 2\.5 total Bases/i);
});

test('provisional MLB screener rows are shown but not persisted', () => {
  const text = renderScreenerSummaryBlocks([{
    player: 'Pre Lineup', team: 'Away', opponent: 'Home', sport: 'mlb',
    eventDate: '2026-09-06', eventId: 456, market: 'hits', side: 'over',
    suggestedLine: 0.5, marketLine: 0.5, confidencePct: 60, grade: 'B',
    sampleSize: 20, modelVersion: 'empirical-beta-v1', source: 'statsapi.mlb.com',
    inLineupToday: false,
  }], 1);
  assert.match(text, /provisional/i);
  assert.match(text, /\`\`\`sgp/);
  assert.doesNotMatch(text, /\[PREDICTION_LOG\]/);
});


test('explicit moneyline request routes to game markets, never player props', () => {
  const intent = inferScreenerIntent('Give me any good NFL moneyline plays');
  assert.equal(intent.sport, 'nfl');
  assert.equal(intent.requestKind, 'game_market');
  assert.equal(intent.gameMarket, 'moneyline');
  assert.equal(intent.market, undefined);
  assert.equal(intent.side, undefined);
});

test('explicit NFL prop request stays in player-prop routing', () => {
  const intent = inferScreenerIntent('Give me 5 NFL passing yards props');
  assert.equal(intent.sport, 'nfl');
  assert.equal(intent.requestKind, 'player_prop');
  assert.equal(intent.market, 'passingYards');
  assert.equal(intent.requestedPicks, 5);
});

test('generic NFL picks are mixed-market eligible', () => {
  const intent = inferScreenerIntent('Give me the best 5 NFL picks');
  assert.equal(intent.sport, 'nfl');
  assert.equal(intent.requestKind, 'mixed');
  assert.equal(intent.requestedPicks, 5);
});

test('game market screener is registered', () => {
  const names = getToolSchemas().map((tool) => tool.function.name);
  assert.ok(names.includes('game_market_screener'));
});

test('moneyline renderer emits team leg and tracked prediction', () => {
  const text = renderScreenerSummaryBlocks([{
    candidateType: 'game_market',
    entityType: 'team',
    sport: 'nfl',
    eventDate: '2026-09-09',
    eventId: 'game-1',
    team: 'Seattle Seahawks',
    opponent: 'New England Patriots',
    market: 'moneyline',
    selection: 'Seattle Seahawks ML',
    marketOdds: -150,
    confidencePct: 60,
    grade: 'B',
    modelVersion: 'market-consensus-v1',
    qualitySource: 'market-consensus-v1',
    source: 'api.sportsgameodds.com',
    lineLabel: 'CONSENSUS MONEYLINE',
    marketBook: 'SportsGameOdds consensus'
  }], 1);
  assert.match(text, /Seattle Seahawks ML/);
  assert.match(text, /Moneyline -150/);
  assert.match(text, /no-vig market probability 60%/);
  assert.match(text, /"entity_type":"team"/);
  assert.match(text, /"quality_source":"market-consensus-v1"/);
  assert.match(text, /\[PREDICTION_LOG\]/);
  assert.match(text, /"bet_type":"MONEYLINE"/);
});


test('same-game intent is passed to the structured slate screener', () => {
  const intent = inferScreenerIntent('Build me a 5-6 leg NFL Same Game Parlay');
  assert.equal(intent.sport, 'nfl');
  assert.equal(intent.sameGame, true);
  assert.equal(intent.requestedPicks, 6);
});
