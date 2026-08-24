import { useMemo, useState } from 'react';
import {
  americanToDecimal,
  combineDecimalOdds,
  decimalToAmerican,
  evFromConfidence,
  formatAmerican,
  gradeForConfidence,
  legKey,
  type Grade,
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

type OddsFormat = 'american' | 'decimal';

const DOT: Record<Grade, string> = {
  A: 'bg-edge',
  B: 'bg-sky2',
  C: 'bg-warn',
  D: 'bg-danger',
};

const HEALTH_TONE = {
  strong: 'border-edge/20 bg-edge/5 text-edge',
  good: 'border-sky2/20 bg-sky2/5 text-sky2',
  aggressive: 'border-warn/20 bg-warn/5 text-warn',
  unscored: 'border-line bg-panel2 text-frost2',
} as const;

const STAKE_STORAGE_KEY = 'sports-edge:slip-stake';

function decimalFormat(decimal: number): string {
  return decimal.toFixed(2);
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
  const [oddsFormat, setOddsFormat] = useState<OddsFormat>('american');
  const [stake, setStake] = useState<number>(() => {
    try {
      const raw = localStorage.getItem(STAKE_STORAGE_KEY);
      const n = raw == null ? NaN : Number(raw);
      return Number.isFinite(n) && n > 0 ? n : 1;
    } catch {
      return 1;
    }
  });

  function updateStake(value: number) {
    setStake(value);
    try { localStorage.setItem(STAKE_STORAGE_KEY, String(value)); } catch { /* ignore */ }
  }

  const combined = useMemo(() => {
    if (legs.length === 0) return null;
    const allPriced = legs.every((leg) => typeof leg.odds === 'number' && Number.isFinite(leg.odds));
    if (!allPriced) return null;
    const product = combineDecimalOdds(legs.map((leg) => americanToDecimal(leg.odds as number)));
    return product == null ? null : decimalToAmerican(product);
  }, [legs]);

  // EV per unit across the parlay, using each leg's stated model confidence.
  // Derived arithmetic only — never an invented confidence.
  const evSummary = useMemo(() => {
    const priced = legs.filter((leg) => typeof leg.odds === 'number' && Number.isFinite(leg.odds)
      && typeof leg.confidence === 'number');
    if (priced.length === 0 || priced.length !== legs.length) return null;
    const evs = priced.map((leg) => evFromConfidence(leg.confidence as number, leg.odds as number));
    if (evs.some((ev) => !Number.isFinite(ev))) return null;
    const combinedEv = evs.reduce((acc, ev) => acc * (1 + ev), 1) - 1;
    return combinedEv;
  }, [legs]);

  const potentialPayout = useMemo(() => {
    if (combined == null || !(stake > 0)) return null;
    const decimal = americanToDecimal(combined);
    if (!Number.isFinite(decimal)) return null;
    return stake * decimal;
  }, [combined, stake]);

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
    <aside className={`flex flex-col overflow-hidden rounded-xl border border-line bg-panel shadow-[0_12px_34px_rgba(0,0,0,0.2)] ${className}`}>
      <div className="flex min-h-10 shrink-0 items-center justify-between gap-2 border-b border-line px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 text-frost2" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M8 21h12M12 17v4M17 3H7a1 1 0 00-1 1v12a1 1 0 001 1h10a1 1 0 001-1V4a1 1 0 00-1-1z" />
            <path d="M9 7h6M9 11h6" />
          </svg>
          <h2 className="text-[12px] font-semibold text-head">Parlay slip</h2>
          <span className="font-mono text-[9px] text-frost2">{legs.length} {legs.length === 1 ? 'leg' : 'legs'}</span>
        </div>
        {legs.length > 0 ? (
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => setOddsFormat((f) => (f === 'american' ? 'decimal' : 'american'))}
              title="Toggle odds format"
              aria-label={`Odds format: ${oddsFormat}. Toggle to ${oddsFormat === 'american' ? 'decimal' : 'American'}`}
              className="h-7 rounded-md border border-line px-1.5 font-mono text-[9px] font-medium text-frost2 hover:bg-panel2 hover:text-head focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-edge/30"
            >
              {oddsFormat === 'american' ? 'AML' : 'DEC'}
            </button>
            <button type="button" onClick={copyParlay} className="h-7 rounded-md px-2 text-[9px] font-medium text-frost2 hover:bg-panel2 hover:text-head focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-edge/30" aria-label="Copy parlay to clipboard">
              {copyState === 'copied' ? 'Copied' : copyState === 'error' ? 'Copy failed' : 'Copy'}
            </button>
            {onClear ? (
              <button type="button" onClick={onClear} className="h-7 rounded-md px-2 text-[9px] font-medium text-frost2 hover:bg-panel2 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/30">Clear</button>
            ) : null}
          </div>
        ) : null}
      </div>

      {legs.length === 0 ? (
        <div className="px-4 py-5 text-center">
          <p className="font-mono text-[9px] uppercase tracking-[0.1em] text-frost2">No picks</p>
          <p className="mt-1.5 text-[11px] leading-relaxed text-frost2">Verified structured legs will stack here.</p>
        </div>
      ) : (
        <ul className="min-h-0 flex-1 divide-y divide-line overflow-y-auto">
          {legs.map((leg) => {
            const grade = typeof leg.confidence === 'number' ? gradeForConfidence(leg.confidence) : null;
            const line = leg.line != null && leg.line !== '' ? ` ${leg.line}` : '';
            const showOdds = oddsFormat === 'decimal'
              ? leg.odds != null
                ? decimalFormat(americanToDecimal(leg.odds as number))
                : null
              : leg.odds != null
                ? formatAmerican(leg.odds)
                : null;
            return (
              <li key={legKey(leg)} className="group relative px-3 py-2.5 hover:bg-panel2/55">
                <div className="flex items-start gap-2 pr-6">
                  <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${grade ? DOT[grade.grade] : 'bg-frost2/50'}`} title={grade ? `AI Grade ${grade.grade} - ${grade.label}` : 'No confidence grade'} />
                  <p className="line-clamp-3 min-w-0 flex-1 text-[11px] font-semibold leading-[1.45] text-head">{leg.selection || '-'}</p>
                  <button type="button" onClick={() => onRemove(legKey(leg))} title="Remove from slip" aria-label="Remove from slip" className="absolute right-2.5 top-2 flex h-6 w-6 items-center justify-center rounded-md text-frost2 opacity-70 hover:bg-danger/10 hover:text-danger sm:opacity-0 sm:group-hover:opacity-100">
                    <svg viewBox="0 0 20 20" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l8 8M14 6l-8 8" /></svg>
                  </button>
                </div>
                <p className="mt-1 line-clamp-2 pl-3.5 font-mono text-[10px] leading-relaxed text-frost2">
                  {[leg.sport, leg.game].filter(Boolean).join(' · ') || '-'}
                  {leg.market ? ` · ${leg.market}${line}` : ''}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1 pl-3.5">
                  <span className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-medium tabular-nums ${leg.odds != null ? 'border-edge/20 bg-edge/5 text-edge' : 'border-line bg-panel2 text-frost2'}`}>
                    {showOdds ?? 'Odds N/A'}
                  </span>
                  {leg.game_odds ? (
                    <span title="Real game moneyline from the live odds source; prop-level price unavailable" className="rounded border border-warn/20 bg-warn/5 px-1.5 py-0.5 font-mono text-[10px] font-medium tabular-nums text-warn">ML {leg.game_odds}</span>
                  ) : null}
                  {grade ? (
                    <span className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-medium tabular-nums ${grade.grade === 'A' ? 'border-edge/20 bg-edge/5 text-edge' : grade.grade === 'B' ? 'border-sky2/20 bg-sky2/5 text-sky2' : grade.grade === 'C' ? 'border-warn/20 bg-warn/5 text-warn' : 'border-danger/20 bg-danger/5 text-danger'}`} title={grade.label}>
                      {grade.grade} · {leg.confidence}%
                    </span>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {legs.length > 0 ? (
        <div className="shrink-0 border-t border-line px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-frost2">Slip health</span>
              <span className={`rounded border px-1.5 py-0.5 font-mono text-[9.5px] font-semibold ${HEALTH_TONE[health.level]}`}>{health.label}</span>
            </div>
            <div className="flex items-center gap-2 font-mono text-[10px] text-frost2">
              <span title="Average confidence across scored legs">Avg {health.averageConfidence != null ? `${health.averageConfidence}%` : '-'}</span>
              <span title="Weakest scored leg">Low {health.weakestConfidence != null ? `${health.weakestConfidence}%` : '-'}</span>
              <span title="Unique games represented">Games {health.uniqueEvents || '-'}</span>
            </div>
          </div>
          {(health.duplicateEventLegs > 0 || health.negativeCorrelations > 0) && (
            <p className="mt-1 rounded border border-warn/25 bg-warn/5 px-2 py-1 text-[9px] leading-snug text-warn">
              {health.negativeCorrelations > 0 ? (
                <span>{health.negativeCorrelations} negatively correlated leg{health.negativeCorrelations === 1 ? '' : 's'}. </span>
              ) : null}
              {health.duplicateEventLegs > 0 ? <span>Multiple legs from the same game — correlated outcome risk.</span> : null}
            </p>
          )}
        </div>
      ) : null}

      <div className="shrink-0 space-y-2 border-t border-line bg-panel2/35 px-3 py-3">
        {/* Stake + payout */}
        <div className="flex items-center justify-between gap-3">
          <label className="flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-frost2">Stake</span>
            <input
              type="number"
              inputMode="decimal"
              min={0.5}
              step={0.5}
              value={stake}
              onChange={(e) => updateStake(Number(e.target.value))}
              onBlur={(e) => { if (!(Number(e.target.value) > 0)) updateStake(1); }}
              aria-label="Stake in units"
              className="w-16 rounded border border-line bg-panel px-2 py-1 text-right font-mono text-[11px] tabular-nums text-head outline-none focus:border-edge/50"
            />
            <span className="font-mono text-[10px] text-frost2">u</span>
          </label>
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-frost2">Combined</span>
            <span className={`font-mono text-[12px] font-semibold tabular-nums ${combined != null ? 'text-edge' : 'text-frost2'}`} title={combined == null && legs.length > 0 ? 'Not all legs are priced' : undefined}>
              {combined != null
                ? (oddsFormat === 'decimal' ? decimalFormat(americanToDecimal(combined)) : formatAmerican(combined))
                : '-'}
            </span>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-frost2">Potential payout</span>
          <span className={`font-mono text-[12px] font-bold tabular-nums ${potentialPayout != null ? 'text-head' : 'text-frost2'}`}>
            {potentialPayout != null ? `${potentialPayout.toFixed(2)} u` : '—'}
          </span>
        </div>

        {evSummary != null && (
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-frost2" title="Estimated edge across the parlay using each leg's stated model confidence">EV summary</span>
            <span className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-bold tabular-nums ${evSummary >= 0 ? 'border-edge/25 bg-edge/10 text-edge' : 'border-warn/25 bg-warn/10 text-warn'}`}>
              {evSummary >= 0 ? '+' : ''}{(evSummary * 100).toFixed(1)}%
            </span>
          </div>
        )}

        {legs.length > 0 && onSave ? (
          <>
            <button type="button" onClick={onSave} disabled={saveStatus.state === 'saving' || unsavedCount === 0} className="mt-0.5 flex h-9 w-full items-center justify-center rounded-md bg-edge px-3 text-[11px] font-bold text-ink hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-edge/40 disabled:cursor-not-allowed disabled:bg-line disabled:text-frost2">
              {saveStatus.state === 'saving' ? 'Saving…' : unsavedCount === 0 ? 'All picks tracked' : `Save & track ${unsavedCount === 1 ? 'bet' : `${unsavedCount} picks`}`}
            </button>
            <p aria-live="polite" className={`min-h-3 text-[9px] leading-snug ${saveStatus.state === 'error' ? 'text-danger' : saveStatus.state === 'success' ? 'text-edge' : 'text-frost2/80'}`}>
              {saveStatus.message ?? 'Saves to the results ledger. It does not place a wager.'}
            </p>
          </>
        ) : null}
        <p className="text-[9px] leading-snug text-frost2/65">Parlays amplify variance. Size in fractional units.</p>
      </div>
    </aside>
  );
}
