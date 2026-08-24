// Tests for the redesigned UI's derived math and navigation contract.
// Everything asserted here is arithmetic over real fields — the same rule the
// app itself follows: no invented numbers.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { americanToImplied, evFromConfidence, gradeForConfidence, combineDecimalOdds, decimalToAmerican } from '../src/lib/odds';

test('implied probability from American odds', () => {
  assert.equal(americanToImplied(-130).toFixed(4), '0.5652');
  assert.equal(americanToImplied(150).toFixed(4), '0.4000');
});

test('EV from confidence and American odds (per unit)', () => {
  // 60% confidence at +100 → 0.6*2 − 1 = +0.20
  const ev = evFromConfidence(60, 100);
  assert.ok(Math.abs(ev - 0.2) < 1e-9, `expected 0.2 got ${ev}`);
  // Negative EV stays negative — nothing clamps it positive.
  assert.ok(evFromConfidence(40, 100) < 0);
});

test('grades follow fixed thresholds', () => {
  assert.equal(gradeForConfidence(65).grade, 'A');
  assert.equal(gradeForConfidence(58).grade, 'B');
  assert.equal(gradeForConfidence(50).grade, 'C');
  assert.equal(gradeForConfidence(49.9).grade, 'D');
});

test('combined parlay odds multiply decimal legs', () => {
  const combined = combineDecimalOdds([2.0, 1.5]);
  assert.equal(decimalToAmerican(combined!), 200); // 3.0 decimal → +200
});

test('nav exposes admin-only Model Lab only for admins', async () => {
  const { navItems } = await import('../src/lib/nav');
  const customerItems = navItems(false);
  const adminItems = navItems(true);
  assert.equal(customerItems.some((i) => i.id === 'model-lab'), false);
  assert.equal(adminItems.some((i) => i.id === 'model-lab'), true);
  // Core destinations exist for everyone.
  for (const id of ['today', 'chat', 'best-bets', 'parlays', 'my-picks', 'results']) {
    assert.ok(adminItems.some((i) => i.id === id), `missing nav item: ${id}`);
    assert.ok(customerItems.some((i) => i.id === id), `missing customer nav item: ${id}`);
  }
});
