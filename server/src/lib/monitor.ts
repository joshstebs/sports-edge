// Real-Time Injury/Lineup Monitoring with Push Alerts
// Monitors game-day lineups and injury reports, alerts when legs become invalid

import { getPendingPredictions, updatePrediction, Prediction } from './predictionStore.js';
import { checkPlayerAvailability, verifyRecommendationAvailability } from '../providers/playerAvailability.js';

export interface MonitorAlert {
  predictionId: string;
  legName: string;
  playerName: string;
  sport: string;
  alertType: 'scratch' | 'injury' | 'lineup_change' | 'game_state';
  severity: 'critical' | 'warning' | 'info';
  message: string;
  action: 'invalidated' | 'at_risk' | 'confirmed';
  details: {
    playingStatus?: string;
    confirmedInLineup?: boolean;
    gameDayState?: string;
    reason: string;
  };
  detectedAt: string;
}

export interface MonitorResult {
  alerts: MonitorAlert[];
  predictionsChecked: number;
  legsChecked: number;
  alertsBySeverity: { critical: number; warning: number; info: number };
}

/** Configuration for monitoring */
export interface MonitorConfig {
  checkIntervalMinutes: number;     // How often to run checks
  gameDayWindowMinutes: number;     // Check from X minutes before game to game end
  watchlistPaths: string[];         // Player names to always monitor
}

export const DEFAULT_MONITOR_CONFIG: MonitorConfig = {
  checkIntervalMinutes: 30,
  gameDayWindowMinutes: 180,        // Start checking 3 hours before game time
  watchlistPaths: [],
};

/** Run a monitoring cycle */
export async function runMonitoringCycle(config: MonitorConfig = DEFAULT_MONITOR_CONFIG): Promise<MonitorResult> {
  const predictions = await getPendingPredictions();
  const alerts: MonitorAlert[] = [];
  let legsChecked = 0;
  
  const now = new Date();
  const nowMs = now.getTime();
  
  for (const prediction of predictions) {
    // Check if game is within monitoring window
    const gameTime = prediction.gameDate ? new Date(prediction.gameDate).getTime() : 0;
    const minutesToGame = (gameTime - nowMs) / (1000 * 60);
    
    if (minutesToGame > config.gameDayWindowMinutes || minutesToGame < -240) {
      // Game already started (>4 hours past) or too far in future
      continue;
    }
    
    for (const leg of prediction.legs) {
      legsChecked++;
      
      try {
        // Check availability for this specific player/leg
        const availability = await verifyRecommendationAvailability({
          player: leg.leg_name,
          team: prediction.matchup?.split(' vs ')[0] || '',
          sport: prediction.sport.toLowerCase(),
          date: prediction.gameDate || undefined,
          gamePk: prediction.gamePk || undefined,
          eventId: prediction.event_id || undefined,
        });
        
        // Detect issues
        const alert = detectIssue(prediction, leg, availability, minutesToGame);
        if (alert) {
          alerts.push(alert);
        }
      } catch (error) {
        console.warn(`[Monitor] Failed to check leg for ${leg.leg_name}:`, error);
      }
    }
  }
  
  // Send alerts
  const criticalAlerts = alerts.filter(a => a.severity === 'critical');
  if (criticalAlerts.length > 0) {
    await sendAlerts(criticalAlerts);
  }
  
  // Mark predictions as invalidated if critical (one increment per prediction
  // per cycle — multiple invalidated legs on the same ticket share the bump)
  const invalidated = new Set<string>();
  for (const alert of alerts.filter(a => a.action === 'invalidated')) {
    if (invalidated.has(alert.predictionId)) continue;
    invalidated.add(alert.predictionId);
    const prediction = predictions.find(p => p.prediction_id === alert.predictionId);
    const attemptAt = new Date().toISOString();
    await updatePrediction(alert.predictionId, {
      status: 'needs_review',
      evaluationNote: `Leg invalidated by monitoring: ${alert.message}`,
      evaluatedAt: attemptAt,
      evaluationAttempts: (prediction?.evaluationAttempts ?? 0) + 1,
      lastEvaluationAttemptAt: attemptAt,
    });
  }
  
  return {
    alerts,
    predictionsChecked: predictions.length,
    legsChecked,
    alertsBySeverity: {
      critical: alerts.filter(a => a.severity === 'critical').length,
      warning: alerts.filter(a => a.severity === 'warning').length,
      info: alerts.filter(a => a.severity === 'info').length,
    },
  };
}

/** Detect if a leg has an availability issue */
function detectIssue(
  prediction: Prediction,
  leg: { leg_name: string },
  availability: { recommendationEligible: boolean; reason: string; rosterAndInjuryEligible: boolean; gameDay: { verified: boolean; confirmedInLineup?: boolean; reason: string }; playingStatus?: string } | { recommendationEligible: boolean; reason: string } | null,
  minutesToGame: number
): MonitorAlert | null {
  if (!availability) {
    // Could not check - informational
    return {
      predictionId: prediction.prediction_id,
      legName: leg.leg_name || 'unknown',
      playerName: leg.leg_name || 'unknown',
      sport: prediction.sport,
      alertType: 'lineup_change',
      severity: 'info',
      message: 'Unable to verify availability.',
      action: 'at_risk',
      details: {
        reason: 'Verification failed',
      },
      detectedAt: new Date().toISOString(),
    };
  }

  if (!availability.recommendationEligible) {
          // Leg is no longer eligible
          const isScratch = availability.reason?.toLowerCase().includes('scratch') || false;
          const isInjury = availability.reason?.toLowerCase().includes('injury') || false;
    
          return {
            predictionId: prediction.prediction_id,
            legName: leg.leg_name || 'unknown',
            playerName: leg.leg_name || 'unknown',
            sport: prediction.sport,
            alertType: isScratch ? 'scratch' : isInjury ? 'injury' : 'game_state',
            severity: 'critical',
            message: availability.reason,
            action: 'invalidated',
            details: {
              playingStatus: ('playingStatus' in availability ? availability.playingStatus : undefined),
              confirmedInLineup: ('gameDay' in availability ? availability.gameDay.confirmedInLineup : undefined) ?? undefined,
              gameDayState: ('gameDay' in availability ? availability.gameDay.reason : undefined) ?? undefined,
              reason: availability.reason,
            },
            detectedAt: new Date().toISOString(),
          };
        }

        if (minutesToGame > 0 && minutesToGame < 120) {
          // Close to game time, check if lineup confirmed
          if ('gameDay' in availability && !availability.gameDay.verified) {
            return {
              predictionId: prediction.prediction_id,
              legName: leg.leg_name || 'unknown',
              playerName: leg.leg_name || 'unknown',
              sport: prediction.sport,
              alertType: 'lineup_change',
              severity: 'warning',
              message: `Lineup not yet confirmed: ${availability.gameDay.reason}`,
              action: 'at_risk',
              details: {
                gameDayState: availability.gameDay.reason,
                reason: 'Lineup verification pending',
              },
              detectedAt: new Date().toISOString(),
            };
          }
        }

        // Check if we have a "confirmed in lineup" status change
        if ('gameDay' in availability && availability.gameDay.confirmedInLineup === false && minutesToGame > 0 && minutesToGame < 60) {
          return {
            predictionId: prediction.prediction_id,
            legName: leg.leg_name || 'unknown',
            playerName: leg.leg_name || 'unknown',
            sport: prediction.sport,
            alertType: 'lineup_change',
            severity: 'critical',
            message: `Player not confirmed in lineup: ${availability.gameDay.reason}`,
            action: 'invalidated',
            details: {
              confirmedInLineup: false,
              gameDayState: availability.gameDay.reason,
              reason: 'Player not in confirmed batting order or not listed as probable pitcher',
            },
            detectedAt: new Date().toISOString(),
          };
        }

        return null;
}

/** Send alerts via configured channels */
async function sendAlerts(alerts: MonitorAlert[]): Promise<void> {
  // Group alerts by prediction
  const byPrediction = new Map<string, MonitorAlert[]>();
  for (const alert of alerts) {
    if (!byPrediction.has(alert.predictionId)) {
      byPrediction.set(alert.predictionId, []);
    }
    byPrediction.get(alert.predictionId)!.push(alert);
  }
  
  // In production, this would send push notifications, emails, or SSE events
  // For now, log critical alerts
  console.warn(`[Monitor] ${alerts.length} critical alerts detected`);
  
  for (const [predId, predAlerts] of byPrediction) {
    const alertSummary = predAlerts.map(a => 
      `[${a.severity.toUpperCase()}] ${a.playerName}: ${a.message}`
    ).join('\n');
    
    console.warn(`[Monitor] Alert for prediction ${predId}:\n${alertSummary}`);
    
    // TODO: Send push notification via SSE or webhook
    // await sendPushNotification(predId, predAlerts);
  }
}

/** Watch specific players (for user watchlist) */
export async function checkWatchlist(
  playerNames: string[],
  sports: string[]
): Promise<{ playerName: string; sport: string; availability: any; alert: string }[]> {
  const results: { playerName: string; sport: string; availability: any; alert: string }[] = [];
  
  for (const sport of sports) {
    for (const player of playerNames) {
      try {
        const availability = await checkPlayerAvailability(player, sport as any);
        let alert = '';
        if (!availability.recommendationEligible) {
          alert = availability.reason;
        } else if (availability.playingStatus !== 'active') {
          alert = `Status changed to: ${availability.playingStatus}`;
        }
        
        results.push({ playerName: player, sport, availability, alert });
      } catch (error) {
        results.push({ 
          playerName: player, 
          sport, 
          availability: null, 
          alert: `Check failed: ${error}` 
        });
      }
    }
  }
  
  return results;
}

/** Create SSE stream for real-time alerts */
export function createAlertStream(predictionId: string) {
  // This would be connected to an SSE endpoint
  // For now, return a function that can emit alerts
  const listeners: Array<(alert: MonitorAlert) => void> = [];
  
  function emit(alert: MonitorAlert) {
    if (alert.predictionId === predictionId) {
      listeners.forEach(l => l(alert));
    }
  }
  
  return {
    subscribe: (callback: (alert: MonitorAlert) => void) => {
      listeners.push(callback);
      return () => {
        const idx = listeners.indexOf(callback);
        if (idx >= 0) listeners.splice(idx, 1);
      };
    },
    emit,
  };
}

/** Get current monitoring status */
export async function getMonitorStatus(): Promise<{
  pendingPredictions: number;
  upcomingGames: number;
  recentAlerts: MonitorAlert[];
  lastRun: string | null;
}> {
  const predictions = await getPendingPredictions();
  const now = new Date();
  const upcoming = predictions.filter(p => {
    const gameTime = new Date(p.gameDate || '');
    return gameTime.getTime() > now.getTime() && gameTime.getTime() - now.getTime() < 3 * 60 * 60 * 1000;
  });
  
  return {
    pendingPredictions: predictions.length,
    upcomingGames: upcoming.length,
    recentAlerts: [], // Would come from a cache in production
    lastRun: new Date().toISOString(),
  };
}