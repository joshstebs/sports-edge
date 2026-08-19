// Monitor API Route
// Exposes monitoring status and manual trigger endpoints

import { Router, Request, Response } from 'express';
import { runMonitoringCycle, checkWatchlist, getMonitorStatus, MonitorAlert } from '../lib/monitor.js';

export const monitorRouter = Router();

/** GET /api/monitor/status — Current monitoring status */
monitorRouter.get('/status', async (_req: Request, res: Response) => {
  try {
    const status = await getMonitorStatus();
    res.json({
      success: true,
      ...status,
    });
  } catch (error) {
    console.error('Monitor status fetch failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Monitor status fetch failed',
    });
  }
});

/** POST /api/monitor/run — Manually trigger a monitoring cycle (admin) */
monitorRouter.post('/run', async (_req: Request, res: Response) => {
  try {
    const result = await runMonitoringCycle();
    res.json({
      success: true,
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Manual monitor run failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Monitor run failed',
    });
  }
});

/** POST /api/monitor/watchlist — Check specific players */
monitorRouter.post('/watchlist', async (req: Request, res: Response) => {
  try {
    const { playerNames, sports } = req.body;
    
    if (!Array.isArray(playerNames) || !playerNames.length) {
      return res.status(400).json({
        success: false,
        error: 'playerNames must be a non-empty array',
      });
    }
    
    if (!Array.isArray(sports) || !sports.length) {
      return res.status(400).json({
        success: false,
        error: 'sports must be a non-empty array',
      });
    }
    
    const results = await checkWatchlist(playerNames, sports);
    
    res.json({
      success: true,
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Watchlist check failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Watchlist check failed',
    });
  }
});

/** GET /api/monitor/alerts/:predictionId — Get alerts for a specific prediction */
monitorRouter.get('/alerts/:predictionId', async (req: Request, res: Response) => {
  try {
    const { predictionId } = req.params;
    
    // In production, this would fetch from an alerts cache/store
    // For now, return empty - the monitoring cycle updates predictions directly
    res.json({
      success: true,
      alerts: [],
      predictionId,
    });
  } catch (error) {
    console.error('Alerts fetch failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Alerts fetch failed',
    });
  }
});