import assert from 'node:assert/strict';
import test from 'node:test';
import {
  composeOrdinaryRecommendation,
  recommendationLegDisplayKey,
  screenerCandidateDisplayKey,
  stripStructuredBlocks,
} from '../src/routes/chat.js';

function verifiedCandidate(player: string, overrides: Record<string, unknown> = {}) {
  return {
    sport: 'nfl',
    player,
    team: 'Buffalo Bills',
    opponent: 'New York Jets',
    eventId: 'nfl-1',
    eventDate: '2026-11-09',
    market: 'receivingYards',
    side: 'over',
    suggestedLine: 59.5,
    marketLine: 59.5,
    marketOddsOver: -110,
    marketOddsUnder: -110,
    marketSource: 'api.sportsgameodds.com',
    marketCheckedAt: new Date().toISOString(),
    confidencePct: 62,
    grade: 'B',
    modelVersion: 'empirical-beta-v1',
    source: 'api.sportsgameodds.com',
    recommendationType: 'verified',
    researchOnly: false,
    ...overrides,
  };
}

function researchCandidate(player: string, overrides: Record<string, unknown> = {}) {
  return {
    sport: 'nfl',
    player,
    team: 'Buffalo Bills',
    opponent: 'New York Jets',
    eventId: 'nfl-1',
    eventDate: '2026-11-09',
    market: 'receivingYards',
    side: 'over',
    suggestedLine: 59.5,
    marketLine: null,
    marketOddsOver: null,
    marketOddsUnder: null,
    marketSource: null,
    marketCheckedAt: null,
    confidencePct: 61,
    grade: 'B',
    modelVersion: 'empirical-beta-v1',
    source: 'site.web.api.espn.com',
    recommendationType: 'research',
    researchOnly: true,
    l5Average: 64.2,
    l10Average: 61.8,
    seasonAverage: 60.4,
    seasonSampleSize: 9,
    historicalThreshold: 59.5,
    historicalWins: 7,
    historicalLosses: 2,
    historicalPushes: 0,
    hitFrequency: 0.777,
    dataDate: '2026-11-08',
    rationale: 'Projection +2.1 vs research threshold (supports the OVER); 78% empirical hit rate across 9 current-season decisions',
    ...overrides,
  };
}

function legFor(candidate: any) {
  return {
    entity_type: 'player',
    player_name: candidate.player,
    sport: candidate.sport,
    game: 'Buffalo Bills vs New York Jets',
    eventId: candidate.eventId,
    event_id: candidate.eventId,
    game_date: candidate.eventDate,
    selection: `${candidate.player} OVER ${candidate.marketLine} Receiving Yards`,
    market: candidate.market,
    side: candidate.side,
    line: candidate.marketLine,
    odds: candidate.marketOddsOver,
    confidence: candidate.confidencePct,
    line_verified: true,
    line_source: candidate.marketSource,
    line_checked_at: candidate.marketCheckedAt,
    quality_source: candidate.source,
    model_source: candidate.source,
  };
}

test('2-of-5 qualified picks are displayed with the shortfall reason instead of withheld', () => {
  const candidates = ['Alpha Receiver', 'Bravo Receiver', 'Charlie Receiver', 'Delta Receiver', 'Echo Receiver']
    .map((player) => verifiedCandidate(player));
  const qualifiedLegs = candidates.slice(0, 2).map(legFor);

  const text = composeOrdinaryRecommendation({
    candidates,
    qualifiedLegs,
    requested: 5,
    shortfallReasons: ['3 lacked a current sportsbook line and price'],
  });

  assert.match(text, /Verified slate screen — 2 qualified candidates/);
  assert.match(text, /\*\*Alpha Receiver\*\*/);
  assert.match(text, /\*\*Bravo Receiver\*\*/);
  assert.doesNotMatch(text, /Charlie Receiver/);
  assert.doesNotMatch(text, /Delta Receiver/);
  assert.doesNotMatch(text, /Echo Receiver/);
  assert.match(text, /2 of 5 requested verified picks/);
  assert.match(text, /3 lacked a current sportsbook line and price/);
  assert.doesNotMatch(text, /Recommendation withheld/);
  assert.doesNotMatch(text, /```sgp/);
  assert.doesNotMatch(text, /\[PREDICTION_LOG\]/);
});

test('mixed verified and research results render both sections without leaking research into the slip block', () => {
  const verified = verifiedCandidate('Verified Receiver');
  const research = [
    researchCandidate('Research One'),
    researchCandidate('Research Two'),
    researchCandidate('Research Three'),
  ];

  const text = composeOrdinaryRecommendation({
    candidates: [verified, ...research],
    qualifiedLegs: [legFor(verified)],
    requested: 5,
  });

  assert.match(text, /Verified slate screen — 1 qualified candidate/);
  assert.match(text, /\*\*Verified Receiver\*\*/);
  assert.match(text, /Research-only statistical picks — NOT verified sportsbook lines/);
  assert.match(text, /Research One/);
  assert.match(text, /Research Two/);
  assert.match(text, /Research Three/);
  assert.match(text, /1 of 5 requested verified picks/);
  assert.match(text, /research-only candidate/);
  assert.doesNotMatch(text, /```sgp/);
  assert.doesNotMatch(text, /\[PREDICTION_LOG\]/);
});

test('NFL no-odds fallback renders research picks when no verified legs qualify', () => {
  const candidates = [researchCandidate('No Odds One'), researchCandidate('No Odds Two')];
  const text = composeOrdinaryRecommendation({
    candidates,
    qualifiedLegs: [],
    requested: 5,
    meta: { priceProviderAvailable: false, priceProviderReason: 'SPORTSGAMEODDS_API_KEY not configured' },
  });

  assert.match(text, /Research-only statistical picks — NOT verified sportsbook lines/);
  assert.match(text, /No Odds One/);
  assert.match(text, /No Odds Two/);
  assert.match(text, /0 of 5 requested verified picks/);
  assert.doesNotMatch(text, /Recommendation withheld/);
  assert.doesNotMatch(text, /[+-]\d{3}\b/);
  assert.doesNotMatch(text, /\bEV\b\s*[:+-]?\s*\d/i);
});

test('structurally matching candidate and leg identities agree', () => {
  const candidate = verifiedCandidate('Identity Receiver');
  assert.equal(screenerCandidateDisplayKey(candidate), recommendationLegDisplayKey(legFor(candidate)));
});

test('stripStructuredBlocks removes sgp and prediction-log payloads', () => {
  const text = 'Visible answer\n\n```sgp\n{"legs":[]}\n```\n\n[PREDICTION_LOG]\n{"legs":[]}';
  assert.equal(stripStructuredBlocks(text), 'Visible answer');
});
