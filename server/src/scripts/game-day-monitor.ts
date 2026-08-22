// Game-Day Monitoring Cycle
// Runs every 30 minutes during game-day windows to check lineups and injuries

import { runMonitoringCycle, DEFAULT_MONITOR_CONFIG } from '../lib/monitor.js';

console.log('[Cron] Starting game-day monitoring cycle...');

try {
  const result = await runMonitoringCycle(DEFAULT_MONITOR_CONFIG);
  console.log(`[Cron] Monitoring cycle complete:`);
  console.log(`  - Checked ${result.predictionsChecked} predictions`);
  console.log(`  - Verified ${result.legsChecked} legs`);
  console.log(`  - Alerts: ${result.alertsBySeverity.critical} critical, ${result.alertsBySeverity.warning} warning, ${result.alertsBySeverity.info} info`);
  
  if (result.alertsBySeverity.critical > 0) {
    console.log('[Cron] CRITICAL ALERTS DETECTED - Check logs for details');
  }
} catch (error) {
  console.error('[Cron] Monitoring cycle failed:', error);
  process.exit(1);
}