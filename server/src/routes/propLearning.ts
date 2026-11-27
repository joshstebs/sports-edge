import { Router } from 'express';
import { loadCandidateHistory } from '../candidates/candidateHistory.js';
import { gradePendingCandidateHistory } from '../candidates/candidateGrader.js';
import { learnPropTrends } from '../candidates/propLearning.js';
import { FAST_SLATE_SCREENER_TOOL, SPORT_MARKETS } from '../llm/fastSlateScreenerTool.js';
import type { ModelSport } from '../models/playerPropModel.js';

export const propLearningRouter = Router();
let grading: ReturnType<typeof gradePendingCandidateHistory> | null = null;
function grade() {
  grading ??= gradePendingCandidateHistory({ limit: 40, timeBudgetMs: 12_000 })
    .finally(() => { grading = null; });
  return grading;
}
let scanning = false;

async function report() {
  return learnPropTrends(await loadCandidateHistory()).report;
}

propLearningRouter.get('/', async (_req, res) => {
  res.json(await report());
});

propLearningRouter.post('/grade', async (_req, res) => {
  const run = await grade();
  res.json({ report: await report(), run });
});

propLearningRouter.post('/scan', async (req, res) => {
  const sport = req.body?.sport as ModelSport;
  const market = req.body?.market;
  if (typeof sport !== 'string' || !Object.hasOwn(SPORT_MARKETS, sport)
    || (market !== undefined && !SPORT_MARKETS[sport].includes(market))) {
    res.status(400).json({ error: 'Choose a supported prop market and sport.' });
    return;
  }
  if (scanning) {
    res.status(409).json({ error: 'A slate scan is already in progress.' });
    return;
  }
  scanning = true;
  try {
    const [scan] = await Promise.all([
      FAST_SLATE_SCREENER_TOOL.handler({ sport, market, requestedPicks: 4, maxPlayers: 16 }),
      grade().catch(() => null),
    ]);
    const candidates = scan.available ? scan.data.candidates : [];
    res.json({
      report: await report(),
      scan: {
        reason: scan.reason ?? scan.data?.slate?.priceProviderReason ?? null,
        candidates: candidates.slice(0, 8).map((row: any) => ({
          player: row.player, eventId: row.eventId, side: row.side, market: row.market,
          line: row.recommendationType === 'verified' ? row.marketLine : row.historicalThreshold ?? row.suggestedLine,
          confidencePct: row.confidencePct,
          sampleSize: row.sampleSize,
          priced: row.recommendationType === 'verified',
          odds: row.recommendationType === 'verified'
            ? (row.side === 'over' ? row.marketOddsOver : row.marketOddsUnder) : null,
          edgePct: row.recommendationType === 'verified' ? row.estimatedEdge : null,
        })),
      },
    });
  } finally {
    scanning = false;
  }
});
