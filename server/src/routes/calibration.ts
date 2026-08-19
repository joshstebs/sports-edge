// API Route for Calibration Dashboard
// Exposes CLV tracking and model calibration data

import { Router, Request, Response } from 'express';
import { computeCalibration, getCalibrationForDisplay, runNightlyClvUpdate, SportMarketCalibration } from '../lib/clvTracker.js';

export const calibrationRouter = Router();

/** GET /api/calibration — Full calibration report */
calibrationRouter.get('/', async (req: Request, res: Response) => {
  try {
    const { sport, market } = req.query;
    const calibration = await getCalibrationForDisplay(
      sport as string | undefined,
      market as string | undefined
    );
    
    res.json({
      success: true,
      calibration,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Calibration fetch failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Calibration fetch failed',
    });
  }
});

/** GET /api/calibration/summary — Human-readable summary */
calibrationRouter.get('/summary', async (req: Request, res: Response) => {
  try {
    const calibration = await computeCalibration();
    let summary = '\n=== MODEL CALIBRATION REPORT ===\n';
    
    if (!calibration.length) {
      summary += '\nNo calibration data available (insufficient evaluated samples)';
    } else {
      for (const cm of calibration) {
        summary += `\n${cm.sport.toUpperCase()} - ${cm.market}:`;
        summary += `  Sample: ${cm.overall.totalSample} | Win Rate: ${(cm.overall.overallWinRate * 100).toFixed(1)}% | Brier: ${cm.overall.overallBrier.toFixed(4)} | ROI: ${cm.overall.overallRoi.toFixed(1)}% | CLV Beat: ${cm.overall.overallClvBeatRate.toFixed(1)}% | Avg Cal Error: ${cm.overall.avgCalibrationError.toFixed(3)}`;
        
        for (const b of cm.buckets) {
          if (b.sampleSize < 10) continue;
          const calDir = b.calibrationError > 0 ? 'UNDER-confident' : 'OVER-confident';
          summary += `  ${b.bucket}: n=${b.sampleSize} | Win ${(b.winRate * 100).toFixed(1)}% vs Pred ${(b.avgModelProb * 100).toFixed(1)}% (${calDir} ${Math.abs(b.calibrationError * 100).toFixed(1)}pp) | ROI ${b.roi.toFixed(1)}% | CLV Beat ${b.clvBeatRate.toFixed(1)}%`;
        }
      }
    }
    
    res.set('Content-Type', 'text/plain; charset=utf-8');
    res.send(summary);
  } catch (error) {
    console.error('Calibration summary failed:', error);
    res.status(500).send(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
});

/** POST /api/calibration/refresh — Manual trigger for nightly CLV update (admin) */
calibrationRouter.post('/refresh', async (req: Request, res: Response) => {
  try {
    const result = await runNightlyClvUpdate();
    res.json({
      success: true,
      captured: result.captured,
      calibrationCount: result.calibration.length,
      summary: result.summary,
    });
  } catch (error) {
    console.error('Manual CLV refresh failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'CLV refresh failed',
    });
  }
});

/** GET /api/calibration/evidence — Per-player evidence for chat enrichment */
calibrationRouter.get('/evidence', async (req: Request, res: Response) => {
  try {
    const { sport, market, minGrade } = req.query;
    const calibration = await computeCalibration();
    
    // Flatten to per-player evidence format
    const evidence: any[] = [];
    for (const cm of calibration) {
      if (sport && cm.sport !== sport) continue;
      if (market && cm.market !== market) continue;
      
      for (const b of cm.buckets) {
        if (minGrade) {
          const gradeOrder = ['A', 'B', 'C', 'D'];
          const minIdx = gradeOrder.indexOf(minGrade as string);
          const bucketGrade = b.winRate >= 0.7 ? 'A' : b.winRate >= 0.6 ? 'B' : b.winRate >= 0.5 ? 'C' : 'D';
          if (gradeOrder.indexOf(bucketGrade) > minIdx) continue;
        }
        
        // This would need per-player data which isn't in calibration buckets
        // For now return bucket-level evidence
        evidence.push({
          sport: cm.sport,
          market: cm.market,
          probabilityBucket: b.bucket,
          sampleSize: b.sampleSize,
          winRate: b.winRate,
          avgModelProb: b.avgModelProb,
          calibrationError: b.calibrationError,
          brierScore: b.brierScore,
          roi: b.roi,
          clvBeatRate: b.clvBeatRate,
          grade: b.winRate >= 0.7 ? 'A' : b.winRate >= 0.6 ? 'B' : b.winRate >= 0.5 ? 'C' : 'D',
        });
      }
    }
    
    res.json({
      success: true,
      evidence,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Evidence fetch failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Evidence fetch failed',
    });
  }
});