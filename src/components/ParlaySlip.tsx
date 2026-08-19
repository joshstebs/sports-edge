import { useMemo, useState } from 'react';
import {
  americanToDecimal,
  combineDecimalOdds,
  decimalToAmerican,
  formatAmerican,
  gradeForConfidence,
  legKey,
} from '../lib/odds';
import { analyzeSlipHealth, formatParlayForClipboard } from '../lib/slipHealth';
import type { SgpLeg } from '../types';

interface ParlaySlipProps {
  legs: SgpLeg[];
  onRemove: (key: string) => void;
  onClear?: () => void;
  onSave?: () => void;
  unsavedCount?: number;
  saveStatus?: SlipSaveStatus;
  className?: string;
}

export interface SlipSaveStatus {
  state: 'idle' | 'saving' | 'success' | 'error';
  message?: string;
}

function initials(selection: string | undefined): string {
  const words = (selection ?? 'SE').split(/\s+/).filter(Boolean).slice(0, 2);
  return words.map((word) => word[0]?.toUpperCase()).join('') || 'SE';
}

export default function ParlaySlip({
  legs,
  onRemove,
  onClear,
  onSave,
  unsavedCount = legs.length,
  saveStatus = { state: 'idle' },
  className = '',
}: ParlaySlipProps) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const [stakeUnits, setStakeUnits] = useState(1);
  const decimal = useMemo(() => {
    if (legs.length === 0 || !legs.every((leg) => typeof leg.odds === 'number' && Number.isFinite(leg.odds))) return null;
    return combineDecimalOdds(legs.map((leg) => americanToDecimal(leg.odds as number)));
  }, [legs]);
  const combined = decimal == null ? null : decimalToAmerican(decimal);
  const implied = decimal == null ? null : (1 / decimal) * 100;
  const profitUnits = decimal == null ? null : stakeUnits * (decimal - 1);
  const health = useMemo(() => analyzeSlipHealth(legs), [legs]);

  async function copyParlay() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(formatParlayForClipboard(legs));
      setCopyState('copied');
      window.setTimeout(() => setCopyState('idle'), 1800);
    } catch {
      setCopyState('error');
      window.setTimeout(() => setCopyState('idle'), 2200);
    }
  }

  return (
    <aside className={`se-shell-card flex flex-col overflow-hidden rounded-2xl ${className}`}>
      <div className="border-b border-line/70 p-3.5 sm:p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-line-strong text-edge">
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 3h10a2 2 0 012 2v16l-7-3-7 3V5a2 2 0 012-2z" /><path d="M9 8h6M9 12h6" /></svg>
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-[14px] font-black uppercase tracking-[0.08em] text-head">Parlay slip</h2>
                  <span className="rounded-md border border-edge/35 bg-edge/10 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-edge">{legs.length} legs</span>
                </div>
                <p className="mt-0.5 text-[9px] text-frost2">All displayed prices remain source-dependent and re-verifiable.</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {legs.length > 0 ? <span className="se-verified !px-2 !py-1">✓ verified</span> : null}
            {legs.length > 0 ? (
              <button type="button" onClick={copyParlay} className="rounded-lg border border-line bg-panel/70 px-2.5 py-1.5 text-[9px] font-bold uppercase tracking-wider text-frost2 hover:border-edge/30 hover:text-edge">
                {copyState === 'copied' ? 'Copied' : copyState === 'error' ? 'Retry copy' : 'Copy'}
              </button>
            ) : null}
            {legs.length > 0 && onClear ? <button type="button" onClick={onClear} className="rounded-lg px-2 py-1.5 text-[9px] font-bold uppercase tracking-wider text-frost2 hover:bg-danger/10 hover:text-danger">Clear</button> : null}
          </div>
        </div>
      </div>

      {legs.length === 0 ? (
        <div className="flex min-h-40 flex-col items-center justify-center px-5 py-7 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full border border-line bg-panel/70 text-frost2">＋</div>
          <p className="mt-3 text-[12px] font-semibold text-head">Your verified picks will stack here.</p>
          <p className="mt-1 max-w-xs text-[10px] leading-relaxed text-frost2">Ask SportsEdge for a parlay or add structured recommendations from the analyst.</p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2.5">
          {legs.map((leg, index) => {
            const grade = typeof leg.confidence === 'number' ? gradeForConfidence(leg.confidence) : null;
            return (
              <article key={legKey(leg)} className="group relative overflow-hidden rounded-xl border border-line/80 bg-ink/55">
                <div className="grid grid-cols-[auto_1fr] gap-3 p-3 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
                  <div className="relative flex h-12 w-12 items-center justify-center rounded-full border border-edge/25 bg-edge/10 text-[11px] font-black text-edge">
                    {initials(leg.selection)}
                    <span className="absolute -left-1 -top-1 flex h-5 w-5 items-center justify-center rounded-md border border-edge/45 bg-ink text-[9px] text-edge">{index + 1}</span>
                  </div>
                  <div className="min-w-0">
                    <p className="line-clamp-2 text-[12px] font-bold leading-snug text-head">{leg.selection || 'Recommendation'}</p>
                    <p className="mt-1 truncate text-[9px] text-frost2">{[leg.sport, leg.game].filter(Boolean).join(' · ') || 'Verified event'}</p>
                    <div className="mt-2 grid grid-cols-4 gap-1.5">
                      <div><p className="text-[8px] uppercase tracking-wider text-frost2">Market</p><p className="mt-0.5 truncate text-[9px] font-semibold text-frost">{leg.market || '—'}</p></div>
                      <div><p className="text-[8px] uppercase tracking-wider text-frost2">Line</p><p className="mt-0.5 text-[10px] font-bold text-head">{leg.line ?? '—'}</p></div>
                      <div><p className="text-[8px] uppercase tracking-wider text-frost2">Odds</p><p className={`mt-0.5 text-[10px] font-bold ${leg.odds != null ? 'text-edge' : 'text-frost2'}`}>{leg.odds != null ? formatAmerican(leg.odds) : 'N/A'}</p></div>
                      <div><p className="text-[8px] uppercase tracking-wider text-frost2">Model</p><p className={`mt-0.5 text-[10px] font-bold ${typeof leg.confidence === 'number' ? 'text-sky2' : 'text-frost2'}`}>{typeof leg.confidence === 'number' ? `${leg.confidence.toFixed(1)}%` : '—'}</p></div>
                    </div>
                  </div>
                  <div className="absolute right-2.5 top-2.5 flex items-start gap-2 sm:static">
                    {grade ? <span className="se-grade !h-9 !min-w-9 !text-[15px]">{grade.grade}</span> : null}
                    <button type="button" onClick={() => onRemove(legKey(leg))} title="Remove from slip" aria-label="Remove from slip" className="flex h-7 w-7 items-center justify-center rounded-md text-frost2 opacity-80 hover:bg-danger/10 hover:text-danger sm:opacity-40 sm:group-hover:opacity-100">×</button>
                  </div>
                </div>
                <div className="border-t border-line/55 px-3 py-1.5 text-[8px] font-bold uppercase tracking-wider text-sky2">⌾ {leg.odds != null ? 'Price captured' : 'Unpriced'} · duplicate protection active</div>
              </article>
            );
          })}
        </div>
      )}

      {legs.length > 0 ? (
        <div className="space-y-3 border-t border-line/70 bg-panel/30 p-3.5">
          <div className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-line bg-line/50">
            <div className="bg-ink/75 p-3 text-center"><p className="text-[8px] uppercase tracking-wider text-frost2">Combined odds</p><p className={`mt-1 text-[18px] font-bold ${combined != null ? 'text-edge' : 'text-frost2'}`}>{combined != null ? formatAmerican(combined) : '—'}</p></div>
            <div className="bg-ink/75 p-3 text-center"><p className="text-[8px] uppercase tracking-wider text-frost2">Implied probability</p><p className="mt-1 text-[18px] font-bold text-head">{implied != null ? `${implied.toFixed(1)}%` : '—'}</p></div>
            <div className="bg-ink/75 p-3 text-center"><p className="text-[8px] uppercase tracking-wider text-frost2">Model-rated risk</p><p className="mt-1 text-[12px] font-bold text-edge">{health.label}</p><p className="mt-1 text-[8px] text-frost2">Avg {health.averageConfidence != null ? `${health.averageConfidence}%` : '—'}</p></div>
          </div>

          <div className="rounded-xl border border-line/80 bg-ink/55 p-3">
            <div className="flex items-center justify-between gap-3"><p className="text-[8px] font-bold uppercase tracking-wider text-frost2">Wager units</p><p className="font-mono text-[14px] font-bold text-edge">{stakeUnits.toFixed(2)}u</p></div>
            <input type="range" min="0.25" max="10" step="0.25" value={stakeUnits} onChange={(event) => setStakeUnits(Number(event.target.value))} className="mt-2 w-full accent-[var(--se-green)]" aria-label="Wager units" />
            <div className="mt-1 flex justify-between text-[8px] text-frost2"><span>0.25u</span><span>1u</span><span>2u</span><span>5u</span><span>10u</span></div>
            <div className="mt-2 flex items-center justify-between border-t border-line/55 pt-2"><span className="text-[8px] uppercase tracking-wider text-frost2">Estimated profit</span><span className={`font-mono text-[14px] font-bold ${profitUnits != null ? 'text-edge' : 'text-frost2'}`}>{profitUnits != null ? `${profitUnits.toFixed(2)}u` : '—'}</span></div>
          </div>

          {onSave ? (
            <button type="button" onClick={onSave} disabled={saveStatus.state === 'saving' || unsavedCount === 0} className="flex min-h-11 w-full items-center justify-center rounded-xl bg-gradient-to-r from-edge to-edge2 px-4 text-[12px] font-black uppercase tracking-[0.08em] text-ink shadow-[0_0_24px_rgba(70,223,122,.12)] hover:brightness-105 disabled:cursor-not-allowed disabled:from-line disabled:to-line disabled:text-frost2">
              {saveStatus.state === 'saving' ? 'Saving…' : unsavedCount === 0 ? 'All picks tracked' : `Save to results ledger · ${unsavedCount}`}
            </button>
          ) : null}
          <p aria-live="polite" className={`min-h-3 text-[9px] leading-snug ${saveStatus.state === 'error' ? 'text-danger' : saveStatus.state === 'success' ? 'text-edge' : 'text-frost2'}`}>{saveStatus.message ?? 'Tracking saves the prediction for grading. It does not place a wager.'}</p>
          <p className="se-bottom-legal">Lines and data are verified at time of analysis. Re-verify before placing any wager. Parlays amplify variance.</p>
        </div>
      ) : null}
    </aside>
  );
}
