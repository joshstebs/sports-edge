// Live integration test for SportsGameOdds provider (uses SPORTSGAMEODDS_API_KEY).
// Run: node --import tsx --test server/test/sportsGameOdds.test.ts
import { config } from 'dotenv';
config({ path: new URL('../.env', import.meta.url) });
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sgoConfigured, getSgoFeaturedOdds, getSgoGameOdds, sgoNotice } from '../src/providers/sportsGameOdds.js';

test('provider is configured from env', () => {
  assert.equal(sgoConfigured(), true, 'SPORTSGAMEODDS_API_KEY must be set in server/.env');
});

test('featured odds call returns a well-formed result (live or rate-limited, never throws)', async () => {
  const r = await getSgoFeaturedOdds('nba');
  assert.equal(r.source, 'api.sportsgameodds.com');
  // Either we got live data, or it honestly reports unavailable (off-season / quota).
  if (r.available) {
    assert.ok(r.event?.home && r.event?.away, 'team names present');
    assert.ok(Object.keys(r.markets ?? {}).length > 0, 'has mapped markets');
    console.log(`  LIVE: ${r.event!.away} @ ${r.event!.home} | markets: ${Object.keys(r.markets ?? {}).join(',')}`);
  } else {
    assert.ok(r.reason, 'has a reason when unavailable');
    console.log(`  UNAVAILABLE (expected if free-tier/quota): ${r.reason} | notice: ${sgoNotice()}`);
  }
});

test('game odds call returns a well-formed result (live or rate-limited, never throws)', async () => {
  const r = await getSgoGameOdds('Lakers', 'Celtics', 'nba');
  assert.equal(r.source, 'api.sportsgameodds.com');
  if (r.available) {
    assert.ok(r.markets?.h2h || r.markets?.spreads || r.markets?.totals, 'mapped at least one market');
    console.log(`  LIVE h2h: ${(r.markets?.h2h ?? []).map((m: any) => `${m.teamSide}:${m.bookOdds}`).join(', ')}`);
    console.log(`  props: ${r.props?.available} (${r.props?.reason ?? ''})`);
  } else {
    assert.ok(r.reason, 'has a reason when unavailable');
    console.log(`  UNAVAILABLE: ${r.reason}`);
  }
});

test('market mapping produces parseable american odds when data present', async () => {
  // Re-run featured; if live, confirm bookOdds parses to a number and implied prob computes.
  const r = await getSgoFeaturedOdds('nba');
  if (!r.available) return; // nothing to assert when rate-limited
  const h2h: any[] = r.markets?.h2h ?? [];
  for (const m of h2h) {
    assert.ok(typeof m.bookOdds === 'number', 'bookOdds is numeric');
    assert.ok(m.impliedProbPct >= 0 && m.impliedProbPct <= 100, 'implied prob in range');
  }
});
