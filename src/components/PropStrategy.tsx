import type { PlayerResearchObservation } from '../lib/api';
import { decimalToAmerican, formatAmerican } from '../lib/odds';
import { evaluatePropStrategy } from '../lib/propStrategy';
import QuoteComparison from './QuoteComparison';

function percentage(probability: number | null): string {
  return probability == null ? '—' : `${(probability * 100).toFixed(1)}%`;
}

export default function PropStrategy({ observations, line, side, market }: {
  observations: PlayerResearchObservation[];
  line: number;
  side: 'over' | 'under';
  market: string;
}) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto', year: 'numeric', month: '2-digit', day: '2-digit' });
  const parts = today.formatToParts(new Date());
  const day = ['year', 'month', 'day'].map(key => parts.find(part => part.type === key)?.value).join('-');
  const result = evaluatePropStrategy(observations, line, side, day);
  const fairOdds = result.estimateForQuotes === null ? null : decimalToAmerican(1 / result.estimateForQuotes);
  const { recent, previous } = result.minutes;
  const summary = result.status === 'thin'
    ? 'Too few later decisions to validate either approach. You can still compare prices manually.'
    : result.status === 'weak'
      ? 'The windows disagree or one failed to beat a flat 50% forecast. Pass on a history-based edge for this line.'
      : 'Both windows beat a flat 50% forecast on the replay. The quote comparison can use the lower estimate.';

  return (
    <section className="mt-6 space-y-4 border-t border-line pt-5" aria-labelledby="prop-strategy-title">
      <div>
        <h3 id="prop-strategy-title" className="text-lg font-semibold text-head">Prop strategy check</h3>
        <p className="mt-1 text-sm text-frost2">{market} · {side} {line}</p>
      </div>
      <div className="overflow-x-auto rounded-xl border border-line bg-panel">
        <table className="w-full whitespace-nowrap text-left text-sm tabular-nums">
          <thead className="border-b border-line text-xs text-frost2">
            <tr>
              <th scope="col" className="px-3 py-2">Approach</th>
              <th scope="col" className="px-3 py-2 text-right">History estimate</th>
              <th scope="col" className="px-3 py-2 text-right">Replay Brier</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line text-frost">
            {result.strategies.map(strategy => (
              <tr key={strategy.window}>
                <th scope="row" className="px-3 py-2 font-medium">Last {strategy.window} decisions</th>
                <td className="px-3 py-2 text-right">{percentage(strategy.estimate)}</td>
                <td className="px-3 py-2 text-right">{strategy.brier?.toFixed(3) ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="border-t border-line px-3 py-2 text-xs text-frost2">Each replay forecast uses earlier game dates. Lower Brier is better. A flat 50% forecast scores 0.250.</p>
      </div>
      <div className="space-y-2 text-sm text-frost">
        <p>{result.replay.length} replay decisions across {result.replayDates} dates · {result.pushes} pushes excluded</p>
        <p>{summary}</p>
        {fairOdds != null && <p>History-based break-even price <strong className="font-semibold text-head">{formatAmerican(fairOdds)}</strong> (rounded).</p>}
        {recent != null && previous != null && (
          <p>NBA playing time averaged {recent.average.toFixed(1)} minutes ({recent.sample}/5 games with minutes) versus {previous.average.toFixed(1)} in the previous window ({previous.sample}/5).</p>
        )}
      </div>
      <QuoteComparison strategyEstimate={result.estimateForQuotes === null ? null : result.estimateForQuotes * 100} />
      <details className="rounded-lg border border-line bg-panel px-3 py-2 text-sm text-frost">
        <summary className="cursor-pointer font-semibold text-head">Before you decide</summary>
        <ul className="ml-5 mt-2 list-disc space-y-1">
          <li>Check the player’s active status and expected minutes or role for the upcoming game.</li>
          <li>Confirm the book’s exact player, market, line, and price. Recalculate if the quote moves.</li>
          <li>Compare the quote’s break-even rate with the history estimate. Pass if the price is too short or the evidence is thin.</li>
          <li>Keep the replay in context. It applies today’s chosen line to past stats, and it has no historical book prices or profit measure.</li>
        </ul>
      </details>
    </section>
  );
}
