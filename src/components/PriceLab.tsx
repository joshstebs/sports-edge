import { useState } from 'react';
import { formatAmerican } from '../lib/odds';
import { priceScenario } from '../lib/research';

export default function PriceLab({ confidence, odds }: { confidence: number; odds: number | null }) {
  const [quote, setQuote] = useState(odds == null ? '' : String(odds));
  const result = priceScenario(confidence, quote.trim() ? Number(quote) : NaN);
  return <section className="mt-4 border-t border-line pt-4" aria-label="Price Lab">
    <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="text-sm font-bold text-head">Price Lab <span className="ml-2 font-mono text-[10px] font-normal text-edge">WHAT IF?</span></h4><span className="text-[11px] text-frost2">Stored quote: {odds == null ? 'unavailable' : formatAmerican(odds)}</span></div>
    <p className="mt-1 text-xs leading-relaxed text-frost2">Same selection and line, different price. Compare the quote you see at your book.</p>
    <label className="mt-3 flex items-center gap-3 text-xs text-frost">Your American odds<input type="number" step="1" value={quote} onChange={(e) => setQuote(e.target.value)} placeholder="e.g. -110" className="w-28 rounded-lg border border-line bg-ink px-3 py-2 text-head" /></label>
    <div aria-live="polite" className="mt-3">
      {result ? <><dl className="grid grid-cols-3 gap-3 text-xs"><div><dt className="text-frost2">Break-even</dt><dd className="mt-1 font-mono text-head">{result.breakEven.toFixed(1)}%</dd></div><div><dt className="text-frost2">Model edge</dt><dd className="mt-1 font-mono text-head">{result.edge.toFixed(1)} pp</dd></div><div><dt className="text-frost2">Expected return</dt><dd className={`mt-1 font-mono ${result.ev > 0 ? 'text-edge' : 'text-warn'}`}>{result.ev.toFixed(1)}%</dd></div></dl><p className={`mt-3 text-xs ${result.ev > 0 ? 'text-edge' : 'text-warn'}`}>{result.ev > 0 ? 'Positive under the stored model estimate.' : 'This price has no positive edge under the stored estimate.'}</p></> : <p className="text-xs text-warn">Enter valid American odds of -100 or lower, or +100 or higher.</p>}
    </div>
    <p className="mt-2 text-xs leading-relaxed text-frost2">Scenario only, assuming no pushes. No live quote or availability check is performed. Model uncertainty and push probability can change expected returns; the saved pick is unchanged.</p>
  </section>;
}
