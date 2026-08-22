// CLV (Closing Line Value) Tracking System
// Captures closing lines, computes CLV beat rates, and calibrates model probabilities

import { getAllPredictions, updatePrediction, Prediction, PredictionLeg } from './predictionStore.js';
import { fetchTheOddsAPI, OddsProviderConfig } from '../providers/oddsAggregator.js';

export interface ClvRecord {
  predictionId: string;
  legName: string;
  sport: string;
  market: string;
  side: 'over' | 'under';
  line: number;
  openingOdds: number;
  closingOdds: number;
  openingImplied: number;
  closingImplied: number;
  modelProbability: number;
  clvPercent: number;          // (closingImplied - openingImplied) / openingImplied * 100
  beatClosing: boolean;        // modelProbability > closingImplied
  actualOutcome?: 'won' | 'lost' | 'push';
  gameDate: string;
  capturedAt: string;
}

export interface CalibrationBucket {
  bucket: string;              // e.g., "60-65%"
  predictedProbMin: number;
  predictedProbMax: number;
  sampleSize: number;
  winRate: number;
  avgModelProb: number;
  calibrationError: number;    // winRate - avgModelProb
  brierScore: number;
  roi: number;
  clvBeatRate: number;         // % of bets that beat closing line
  avgClvPercent: number;
}

export interface SportMarketCalibration {
  sport: string;
  market: string;
  buckets: CalibrationBucket[];
  overall: {
    totalSample: number;
    overallWinRate: number;
    overallBrier: number;
    overallRoi: number;
    overallClvBeatRate: number;
    avgCalibrationError: number;
  };
}

/** Configuration for CLV tracking */
export interface ClvConfig {
  oddsApiKey?: string;
  sports: string[];
  captureWindowMinutes: number;    // How close to game time to capture "closing" line
  minSampleForCalibration: number;
}

/** Default configuration */
export const DEFAULT_CLV_CONFIG: ClvConfig = {
  oddsApiKey: process.env.ODDS_API_KEY,
  sports: ['baseball_mlb', 'americanfootball_nfl', 'basketball_nba', 'icehockey_nhl'],
  captureWindowMinutes: 60,        // Capture lines within 60 min of game start
  minSampleForCalibration: 20,
};

/** Capture closing lines for pending predictions */
export async function captureClosingLines(config: ClvConfig = DEFAULT_CLV_CONFIG): Promise<ClvRecord[]> {
  const predictions = await getAllPredictions();
  const pending = predictions.filter(p => p.status === 'pending');
  
  if (pending.length === 0) return [];
  
  // Fetch current odds (closing lines) for relevant games
  const oddsConfig: OddsProviderConfig = {
    theOddsApiKey: config.oddsApiKey,
    sports: config.sports,
    regions: ['us'],
    markets: ['h2h', 'spreads', 'totals', 'player_props'],
    bookmakers: ['pinnacle', 'draftkings', 'fanduel', 'betmgm', 'caesars'],
  };
  
  const liveOdds = await fetchTheOddsAPI(oddsConfig);
  const records: ClvRecord[] = [];
  const now = Date.now();
  
  for (const prediction of pending) {
    const gameTime = prediction.gameDate ? new Date(prediction.gameDate).getTime() : 0;
    const minutesToGame = (gameTime - now) / (1000 * 60);
    
    // Only capture if we're within the capture window of game time
    if (minutesToGame > config.captureWindowMinutes || minutesToGame < -120) continue;
    
    // Find matching game odds
    const gameOdds = liveOdds.find(go => 
      go.gameId === prediction.event_id ||
      go.gameId === prediction.gamePk?.toString() ||
      `${go.awayTeam}_vs_${go.homeTeam}`.toLowerCase() === prediction.matchup.toLowerCase().replace(/\s+/g, '_')
    );
    
    if (!gameOdds) continue;
    
    // Process each leg
    for (const leg of prediction.legs) {
      if (!leg.line || !leg.side || !leg.model_probability) continue;
      
      const modelProb = typeof leg.model_probability === 'string' 
        ? parseFloat(leg.model_probability) 
        : leg.model_probability;
      
      if (!Number.isFinite(modelProb)) continue;
      
      // Find matching market in live odds
      const openingOdds = typeof leg.implied_odds === 'string'
        ? parseInt(leg.implied_odds.replace(/[^\d-]/g, ''), 10)
        : (leg.implied_odds as number | null);
      
      if (!openingOdds) continue;
      
      // Find best closing line for this prop
      const closingMarket = findClosingMarket(gameOdds, leg.leg_name, leg.market || '', leg.side, leg.line);
      if (!closingMarket) continue;
      
      const openingImplied = americanToImplied(openingOdds);
      const closingImplied = americanToImplied(closingMarket.odds);
      const clvPercent = ((closingImplied - openingImplied) / openingImplied) * 100;
      const beatClosing = modelProb > closingImplied;
      
      const record: ClvRecord = {
        predictionId: prediction.prediction_id,
        legName: leg.leg_name,
        sport: prediction.sport,
        market: leg.market || 'unknown',
        side: leg.side,
        line: leg.line,
        openingOdds,
        closingOdds: closingMarket.odds,
        openingImplied,
        closingImplied,
        modelProbability: modelProb,
        clvPercent,
        beatClosing,
        gameDate: prediction.gameDate || '',
        capturedAt: new Date().toISOString(),
      };
      
      records.push(record);
      
      // Update prediction with CLV data
      await updatePrediction(prediction.prediction_id, {
        legs: prediction.legs.map(l => {
          if (l.leg_name !== leg.leg_name) return l;
          return {
            ...l,
            closing_odds: closingMarket.odds,
            closing_implied: closingImplied,
            clv_percent: clvPercent,
            beat_closing: beatClosing,
            clv_captured_at: record.capturedAt,
          };
        }),
      });
    }
  }
  
  return records;
}

/** Find closing market match in live odds */
function findClosingMarket(
  gameOdds: any,
  playerName: string,
  market: string,
  side: 'over' | 'under',
  line: number
): { odds: number; book: string } | null {
  for (const prop of gameOdds.playerProps) {
    const nameMatch = prop.playerName.toLowerCase().includes(playerName.toLowerCase()) ||
      playerName.toLowerCase().includes(prop.playerName.toLowerCase());
    if (!nameMatch) continue;
    
    const exact = prop.markets.find((m: any) => 
      m.market === market && m.side === side && m.line === line
    );
    if (exact) return { odds: exact.odds, book: exact.book };
    
    // Find closest line (seed with the first candidate so best is never null mid-reduce)
    const candidates = prop.markets
      .filter((m: any) => m.market === market && m.side === side);
    if (!candidates.length) continue;
    const best = candidates.reduce((best: any, current: any) => {
      if (!best) return current;
      if (side === 'over') {
        if (current.line > best.line) return current;
        if (current.line === best.line && current.odds > best.odds) return current;
      } else {
        if (current.line < best.line) return current;
        if (current.line === best.line && current.odds > best.odds) return current;
      }
      return best;
    }, null as any);
    
    if (best) return { odds: best.odds, book: best.book };
  }
  return null;
}

/** Convert American odds to implied probability */
function americanToImplied(odds: number): number {
  if (odds > 0) return 100 / (odds + 100);
  return Math.abs(odds) / (Math.abs(odds) + 100);
}

/** Compute calibration buckets from evaluated predictions with CLV data */
export async function computeCalibration(config: ClvConfig = DEFAULT_CLV_CONFIG): Promise<SportMarketCalibration[]> {
  const predictions = await getAllPredictions();
  const evaluated = predictions.filter(p => p.status === 'evaluated');
  
  const buckets = new Map<string, {
    sport: string;
    market: string;
    records: Array<{
      modelProb: number;
      outcome: 'won' | 'lost' | 'push';
      clvPercent: number;
      beatClosing: boolean;
      decimalOdds: number;
    }>;
  }>();
  
  for (const p of evaluated) {
    const sport = p.sport.toLowerCase();
    for (const leg of p.legs) {
      if (leg.outcome !== 'won' && leg.outcome !== 'lost') continue;
      if (!leg.model_probability || !leg.line || !leg.side || !leg.market) continue;
      
      const modelProb = typeof leg.model_probability === 'string'
        ? parseFloat(leg.model_probability)
        : leg.model_probability;
      
      if (!Number.isFinite(modelProb)) continue;
      
      const clvPercent = (leg as any).clv_percent ?? 0;
      const beatClosing = (leg as any).beat_closing ?? false;
      const closingOdds = (leg as any).closing_odds;
      const decimalOdds = closingOdds ? americanToDecimal(closingOdds) : 0;
      
      const key = `${sport}|${leg.market}`;
      if (!buckets.has(key)) {
        buckets.set(key, { sport, market: leg.market, records: [] });
      }
      buckets.get(key)!.records.push({
        modelProb,
        outcome: leg.outcome,
        clvPercent,
        beatClosing,
        decimalOdds,
      });
    }
  }
  
  const results: SportMarketCalibration[] = [];
  
  for (const [key, data] of buckets) {
    if (data.records.length < config.minSampleForCalibration) continue;
    
    // Create probability buckets (5% increments)
    const bucketMap = new Map<string, Array<{
      modelProb: number;
      outcome: 'won' | 'lost' | 'push';
      clvPercent: number;
      beatClosing: boolean;
      decimalOdds: number;
    }>>();
    for (const r of data.records) {
      const bucketKey = `${Math.floor(r.modelProb * 100 / 5) * 5}-${Math.floor(r.modelProb * 100 / 5) * 5 + 5}%`;
      if (!bucketMap.has(bucketKey)) {
        bucketMap.set(bucketKey, []);
      }
      bucketMap.get(bucketKey)!.push(r);
    }
    
    const bucketsList: CalibrationBucket[] = [];
    for (const [bucketName, records] of bucketMap) {
      if (records.length < 5) continue; // Need minimum per bucket
      
      const wins = records.filter((r: { outcome: 'won' | 'lost' | 'push' }) => r.outcome === 'won').length;
      const winRate = wins / records.length;
      const avgModelProb = records.reduce((sum: number, r: { modelProb: number }) => sum + r.modelProb, 0) / records.length;
      const calibrationError = winRate - avgModelProb;
      
      // Brier score: mean squared error of probability forecasts
      const brierScore = records.reduce((sum: number, r: { modelProb: number; outcome: 'won' | 'lost' | 'push' }) => {
        const actual = r.outcome === 'won' ? 1 : 0;
        return sum + Math.pow(r.modelProb - actual, 2);
      }, 0) / records.length;
      
      // ROI assuming flat 1 unit bets at closing odds.
      // Legs without captured closing odds have no price — exclude them from
      // ROI instead of booking wins as -1 unit (decimalOdds would be 0).
      const pricedRecords = records.filter((r: { decimalOdds: number }) => r.decimalOdds > 0);
      const roi = pricedRecords.length
        ? pricedRecords.reduce((sum: number, r: { outcome: 'won' | 'lost' | 'push'; decimalOdds: number }) => {
            if (r.outcome === 'won') return sum + (r.decimalOdds - 1);
            return sum - 1;
          }, 0) / pricedRecords.length * 100
        : 0;
      
      const clvBeats = records.filter((r: { beatClosing: boolean }) => r.beatClosing).length;
      const clvBeatRate = clvBeats / records.length * 100;
      const avgClvPercent = records.reduce((sum: number, r: { clvPercent: number }) => sum + r.clvPercent, 0) / records.length;
      
      const [minStr, maxStr] = bucketName.split('-');
      bucketsList.push({
        bucket: bucketName,
        predictedProbMin: parseInt(minStr) / 100,
        predictedProbMax: parseInt(maxStr.replace('%', '')) / 100,
        sampleSize: records.length,
        winRate,
        avgModelProb,
        calibrationError,
        brierScore,
        roi,
        clvBeatRate,
        avgClvPercent,
      });
    }
    
    // Overall stats
    const totalWins = data.records.filter((r: { outcome: 'won' | 'lost' | 'push' }) => r.outcome === 'won').length;
    const overallWinRate = totalWins / data.records.length;
    const overallBrier = data.records.reduce((sum: number, r: { modelProb: number; outcome: 'won' | 'lost' | 'push' }) => {
      const actual = r.outcome === 'won' ? 1 : 0;
      return sum + Math.pow(r.modelProb - actual, 2);
    }, 0) / data.records.length;
    // Same pricing rule as bucket ROI: only legs with captured closing odds
    // count toward overall ROI (decimalOdds=0 legs would corrupt the math).
    const pricedRecords = data.records.filter((r: { decimalOdds: number }) => r.decimalOdds > 0);
    const overallRoi = pricedRecords.length
      ? pricedRecords.reduce((sum: number, r: { outcome: 'won' | 'lost' | 'push'; decimalOdds: number }) => {
          if (r.outcome === 'won') return sum + (r.decimalOdds - 1);
          return sum - 1;
        }, 0) / pricedRecords.length * 100
      : 0;
    const overallClvBeats = data.records.filter((r: { beatClosing: boolean }) => r.beatClosing).length;
    const overallClvBeatRate = overallClvBeats / data.records.length * 100;
    const avgCalError = bucketsList.reduce((sum, b) => sum + Math.abs(b.calibrationError), 0) / bucketsList.length;
    
    results.push({
      sport: data.sport,
      market: data.market,
      buckets: bucketsList.sort((a, b) => a.predictedProbMin - b.predictedProbMin),
      overall: {
        totalSample: data.records.length,
        overallWinRate,
        overallBrier,
        overallRoi,
        overallClvBeatRate,
        avgCalibrationError: avgCalError,
      },
    });
  }
  
  return results;
}

/** Convert American odds to decimal */
function americanToDecimal(american: number): number {
  return american > 0 ? american / 100 + 1 : 100 / Math.abs(american) + 1;
}

/** Run nightly CLV capture + calibration update (for cron) */
export async function runNightlyClvUpdate(config: ClvConfig = DEFAULT_CLV_CONFIG): Promise<{
  captured: number;
  calibration: SportMarketCalibration[];
  summary: string;
}> {
  console.log('[CLV] Starting nightly CLV capture...');
  const captured = await captureClosingLines(config);
  console.log(`[CLV] Captured closing lines for ${captured.length} legs`);
  
  console.log('[CLV] Computing calibration...');
  const calibration = await computeCalibration(config);
  console.log(`[CLV] Computed calibration for ${calibration.length} sport/market combos`);
  
  const summary = generateCalibrationSummary(calibration);
  
  return { captured: captured.length, calibration, summary };
}

/** Generate human-readable calibration summary */
function generateCalibrationSummary(calibration: SportMarketCalibration[]): string {
  if (!calibration.length) return 'No calibration data available (insufficient evaluated samples)';
  
  const lines = ['\n=== MODEL CALIBRATION REPORT ===' ];
  
  for (const cm of calibration) {
    lines.push(`\n${cm.sport.toUpperCase()} - ${cm.market}:`);
    lines.push(`  Sample: ${cm.overall.totalSample} | Win Rate: ${(cm.overall.overallWinRate * 100).toFixed(1)}% | Brier: ${cm.overall.overallBrier.toFixed(4)} | ROI: ${cm.overall.overallRoi.toFixed(1)}% | CLV Beat: ${cm.overall.overallClvBeatRate.toFixed(1)}% | Avg Cal Error: ${cm.overall.avgCalibrationError.toFixed(3)}`);
    
    for (const b of cm.buckets) {
      if (b.sampleSize < 10) continue;
      const calDir = b.calibrationError > 0 ? 'UNDER-confident' : 'OVER-confident';
      lines.push(`  ${b.bucket}: n=${b.sampleSize} | Win ${(b.winRate * 100).toFixed(1)}% vs Pred ${(b.avgModelProb * 100).toFixed(1)}% (${calDir} ${Math.abs(b.calibrationError * 100).toFixed(1)}pp) | ROI ${b.roi.toFixed(1)}% | CLV Beat ${b.clvBeatRate.toFixed(1)}%`);
    }
  }
  
  return lines.join('\n');
}

/** Get calibration data for a specific sport/market (for API/UI) */
export async function getCalibrationForDisplay(sport?: string, market?: string): Promise<SportMarketCalibration[]> {
  const all = await computeCalibration();
  return all.filter(c => 
    (!sport || c.sport === sport.toLowerCase()) &&
    (!market || c.market === market.toLowerCase())
  );
}