import assert from 'node:assert/strict';
import test from 'node:test';
import { executeTool, getToolSchemas } from '../src/llm/toolRegistry.js';
import { SYSTEM_PROMPT } from '../src/prompt/systemPrompt.js';
import { predictionsToCsv } from '../src/lib/diagnostics.js';

test('provisional MLB model is registered and fails closed without a player', async () => {
  const names = getToolSchemas().map((schema) => schema.function.name);
  assert.ok(names.includes('mlb_provisional_prop_model'));

  const result = await executeTool('mlb_provisional_prop_model', {
    market: 'total_bases', side: 'over', line: 1.5,
  });
  assert.equal(result.ok, false);
  assert.match(result.summary, /no player name provided/i);
});

test('system prompt allows provisional MLB analysis but forbids learning persistence before confirmation', () => {
  assert.match(SYSTEM_PROMPT, /MLB PRE-LINEUP EXCEPTION/i);
  assert.match(SYSTEM_PROMPT, /provisional/i);
  assert.match(SYSTEM_PROMPT, /do NOT emit it in PREDICTION_LOG until final player_availability returns recommendationEligible=true/i);
});

test('prediction CSV exports model/source/closing-line fields and escapes commas', () => {
  const csv = predictionsToCsv([{
    prediction_id: 'p1',
    timestamp: '2026-08-19T08:00:00.000Z',
    sport: 'MLB',
    matchup: 'Toronto Blue Jays vs New York Yankees',
    bet_type: 'PROP',
    status: 'evaluated',
    legs: [{
      leg_name: 'Player, Jr. OVER 1.5 Total Bases',
      target_line: '1.5',
      player_name: 'Player, Jr.',
      market: 'totalBases',
      side: 'over',
      line: 1.5,
      model_probability: 64,
      model_version: 'empirical-beta-v1',
      model_source: 'statsapi.mlb.com official gameLog',
      implied_odds: -110,
      outcome: 'won',
      actual: 2,
      evaluated_at: '2026-08-20T06:00:00.000Z',
      closing_odds: -120,
      closing_odds_source: 'verified close',
    } as any],
  }]);

  assert.match(csv, /model_probability,model_version,model_source,entry_odds,closing_odds/);
  assert.match(csv, /"Player, Jr\. OVER 1\.5 Total Bases"/);
  assert.match(csv, /statsapi\.mlb\.com official gameLog/);
  assert.match(csv, /-120,verified close/);
});
