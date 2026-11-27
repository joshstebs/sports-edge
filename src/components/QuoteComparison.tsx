import { useState } from 'react';
import type { SportsbookQuote } from '../../server/src/workspace';
import { americanToDecimal, americanToImplied, formatAmerican } from '../lib/odds';
import { priceScenario } from '../lib/research';

const control = 'mt-1 min-h-10 w-full rounded-lg border border-line bg-ink px-3 text-sm text-head';

function manualPrice(value: string): number | null {
  const price = Number(value);
  return /^[+-]?\d+$/.test(value.trim()) && Number.isSafeInteger(price) && Math.abs(price) >= 100 ? price : null;
}

export default function QuoteComparison({ quotes = [] }: { quotes?: SportsbookQuote[] }) {
  const [first, setFirst] = useState('');
  const [second, setSecond] = useState('');
  const [estimate, setEstimate] = useState('');
  const manual = [first, second].flatMap((value, index) => {
    const odds = manualPrice(value);
    return odds === null ? [] : [{ book: `Manual quote ${index + 1}`, odds, updatedAt: null, manual: true }];
  });
  const rows = [...quotes.map(row => ({ ...row, manual: false })), ...manual]
    .sort((a, b) => americanToDecimal(b.odds) - americanToDecimal(a.odds));
  const hasInvalid = [first, second].some(value => value.trim() && manualPrice(value) === null);
  const probability = estimate.trim() ? Number(estimate) : NaN;
  const hasEstimate = probability > 0 && probability < 100;
  const best = rows.length > 1 && americanToDecimal(rows[0].odds) > americanToDecimal(rows[rows.length - 1].odds)
    ? americanToDecimal(rows[0].odds) : null;

  return (
    <section className="space-y-3 rounded-xl border border-line bg-panel p-4" aria-label="Compare quotes">
      <div>
        <h3 className="text-base font-semibold text-head">Compare quotes</h3>
        <p className="mt-1 text-sm text-frost2">Enter prices for the same game, selection, and exact line.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-xs text-frost">Manual quote 1
          <input className={control} value={first} onChange={event => setFirst(event.target.value)} placeholder="-110" maxLength={10} />
        </label>
        <label className="text-xs text-frost">Manual quote 2
          <input className={control} value={second} onChange={event => setSecond(event.target.value)} placeholder="+105" maxLength={10} />
        </label>
        <label className="text-xs text-frost">Your probability estimate (%)
          <input className={control} value={estimate} onChange={event => setEstimate(event.target.value)}
            type="number" min="0.01" max="99.99" step="any" placeholder="Optional" />
        </label>
      </div>
      {hasInvalid && <p className="text-sm text-warn">Use whole American odds such as -110 or +105.</p>}
      {estimate.trim() && !hasEstimate && <p className="text-sm text-warn">Enter a probability between 0% and 100%.</p>}
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full whitespace-nowrap text-left text-sm tabular-nums">
            <thead className="border-b border-line text-frost2">
              <tr>
                <th scope="col" className="px-2 py-2">Quote</th>
                <th scope="col" className="px-2 py-2 text-right">Odds</th>
                <th scope="col" className="px-2 py-2 text-right">Break-even</th>
                {hasEstimate && <th scope="col" className="px-2 py-2 text-right">Edge</th>}
                {hasEstimate && <th scope="col" className="px-2 py-2 text-right">Expected return</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-line text-frost">
              {rows.map((row, index) => {
                const scenario = hasEstimate ? priceScenario(probability, row.odds) : null;
                return (
                  <tr key={`${row.book}:${row.manual}:${index}`}>
                    <th scope="row" className="px-2 py-2 text-left font-medium">
                      {row.book}
                      {best === americanToDecimal(row.odds) && <span className="ml-2 text-xs text-edge">Best listed</span>}
                      {row.updatedAt && (
                        <time className="block text-xs font-normal text-frost2" dateTime={row.updatedAt}>{new Date(row.updatedAt).toLocaleString()}</time>
                      )}
                    </th>
                    <td className="px-2 py-2 text-right font-semibold text-head">{formatAmerican(row.odds)}</td>
                    <td className="px-2 py-2 text-right">{(americanToImplied(row.odds) * 100).toFixed(1)}%</td>
                    {scenario && <td className="px-2 py-2 text-right">{scenario.edge.toFixed(1)} pp</td>}
                    {scenario && <td className="px-2 py-2 text-right">{scenario.ev.toFixed(1)}%</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {hasEstimate && <p className="text-xs text-frost2">Scenario uses your estimate and assumes there is no push.</p>}
    </section>
  );
}
