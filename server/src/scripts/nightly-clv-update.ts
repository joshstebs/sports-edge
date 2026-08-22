// Nightly CLV Capture + Calibration Update
// Runs every night at 3 AM to capture closing lines and recompute calibration

import { runNightlyClvUpdate } from '../lib/clvTracker.js';

console.log('[Cron] Starting nightly CLV capture + calibration update...');

try {
  const result = await runNightlyClvUpdate();
  console.log(`[Cron] Nightly CLV update complete:`);
  console.log(`  - Captured closing lines for ${result.captured} legs`);
  console.log(`  - Updated calibration for ${result.calibration.length} sport/market pairs`);
  console.log(result.summary);
} catch (error) {
  console.error('[Cron] Nightly CLV update failed:', error);
  process.exit(1);
}