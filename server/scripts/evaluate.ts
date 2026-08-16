// CLI wrapper around the reusable, deterministic evaluator used by Vercel Cron.
import 'dotenv/config';
import { runPredictionEvaluation } from '../src/lib/evaluator.js';
import { storageStatus } from '../src/lib/predictionStore.js';

async function main(): Promise<void> {
  const result = await runPredictionEvaluation();
  console.log(`SportsEdge evaluation ${result.startedAt} -> ${result.finishedAt}`);
  console.log(`Storage: ${storageStatus().backend}`);
  console.log(`Processed ${result.processed}; evaluated ${result.evaluated}; needs review ${result.needsReview}; deferred ${result.deferred}; remaining pending ${result.remainingPending}`);
  console.log(`Saved-slip legs auto-settled: ${result.ledgerSettled}`);
  console.log(`Cumulative learning: ${result.learning.evaluated} graded legs; hit ${result.learning.hitRate ?? 'n/a'}%; priced ROI ${result.learning.roi ?? 'n/a'}%; Brier ${result.learning.brierScore ?? 'n/a'}`);
  for (const detail of result.details) console.log(`  ${detail.predictionId}: ${detail.status}${detail.note ? ` — ${detail.note}` : ''}`);
}

main().catch((error) => {
  console.error('Evaluation failed:', (error as Error).message);
  process.exitCode = 1;
});
