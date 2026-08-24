import { useMemo, useState } from 'react';
import { Section } from './ui/primitives';

interface ParlayBuilderProps {
  onAsk: (text: string) => void;
  slipCount: number;
  /** Live slip node rendered beneath the builder (mobile sheet + desktop panel). */
  slipSlot?: React.ReactNode;
}

const SPORT_OPTIONS = ['MLB', 'NFL', 'NBA', 'NHL', 'Mixed'] as const;
const RISK_OPTIONS = [
  { id: 'conservative', label: 'Conservative', hint: 'Only higher-confidence, verified legs. Fewer picks qualify.' },
  { id: 'balanced', label: 'Balanced', hint: 'Standard qualifying threshold.' },
  { id: 'aggressive', label: 'Aggressive', hint: 'Wider net across qualifying legs — still positive-edge and verified only.' },
] as const;

type SportChoice = (typeof SPORT_OPTIONS)[number];
type RiskChoice = (typeof RISK_OPTIONS)[number]['id'];

/**
 * Guided parlay builder. This composes a natural-language request for the
 * analyst — it does NOT pick legs itself, so it cannot bypass availability
 * gates, odds verification or the positive-edge requirement. If fewer legs
 * qualify than requested, the analyst says so explicitly and offers
 * alternatives instead of padding with weak legs.
 */
export default function ParlayBuilder({ onAsk, slipCount, slipSlot }: ParlayBuilderProps) {
  const [sport, setSport] = useState<SportChoice>('MLB');
  const [legCount, setLegCount] = useState(4);
  const [scope, setScope] = useState<'single' | 'multi' | 'props' | 'mixed'>('mixed');
  const [risk, setRisk] = useState<RiskChoice>('balanced');
  const [book, setBook] = useState<string>('');

  const request = useMemo(() => {
    const parts: string[] = [];
    parts.push(`Build a ${legCount}-leg parlay`);
    if (sport !== 'Mixed') parts.push(`${sport} only`);
    if (scope === 'single') parts.push('same-game parlay if a qualifying slate exists, otherwise multi-game');
    else if (scope === 'multi') parts.push('multi-game legs only');
    else if (scope === 'props') parts.push('player props only');
    else parts.push('mix of sides and player props');
    parts.push(risk === 'conservative'
      ? 'use your highest-confidence qualifying legs only'
      : risk === 'aggressive'
        ? 'spread across more qualifying legs, but keep every leg positive-edge and fully verified'
        : 'standard qualifying threshold');
    if (book.trim()) parts.push(`prefer prices from ${book.trim()}`);
    parts.push('show model probability, odds and edge for every leg, warn about same-game correlation, and if fewer than ' + legCount + ' legs genuinely qualify, say exactly how many qualified and why — do not pad with weaker picks');
    return parts.join(', ') + '.';
  }, [sport, legCount, scope, risk, book]);

  return (
    <div className="mx-auto w-full max-w-3xl px-3 py-4 pb-24 sm:px-5 md:pb-8">
      <header className="mb-4">
        <h2 className="text-lg font-bold tracking-tight text-head">Build a Parlay</h2>
        <p className="mt-0.5 max-w-2xl text-[11px] leading-relaxed text-muted">
          Set your preferences and SportsEdge assembles the parlay from genuinely qualifying picks.
          Requested more legs than qualify? You’ll see exactly how many made the cut and why — never padded with weak legs.
        </p>
      </header>

      <Section title="Preferences">
        <div className="space-y-4">
          <div>
            <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-frost2">Sport</p>
            <div className="flex flex-wrap gap-1.5">
              {SPORT_OPTIONS.map((s) => (
                <button
                  key={s} type="button" onClick={() => setSport(s)} aria-pressed={sport === s}
                  className={`min-h-9 rounded-lg border px-3 text-[11px] font-bold transition-colors ${sport === s ? 'border-edge/50 bg-edge/15 text-edge' : 'border-line bg-panel text-frost2 hover:bg-panel2 hover:text-frost'}`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-frost2">Legs</p>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={2}
                max={8}
                value={legCount}
                onChange={(e) => setLegCount(Number(e.target.value))}
                aria-label={`Number of legs: ${legCount}`}
                className="h-11 w-full accent-[var(--color-edge)]"
              />
              <span className="w-16 shrink-0 rounded-lg border border-line bg-panel px-2 py-1.5 text-center font-mono text-[13px] font-bold text-head">
                {legCount}
              </span>
            </div>
          </div>

          <div>
            <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-frost2">Scope</p>
            <div className="flex flex-wrap gap-1.5">
              {([
                ['single', 'Same-game'],
                ['multi', 'Multi-game'],
                ['props', 'Player props'],
                ['mixed', 'Mixed'],
              ] as const).map(([id, label]) => (
                <button
                  key={id} type="button" onClick={() => setScope(id)} aria-pressed={scope === id}
                  className={`min-h-9 rounded-lg border px-3 text-[11px] font-bold transition-colors ${scope === id ? 'border-edge/50 bg-edge/15 text-edge' : 'border-line bg-panel text-frost2 hover:bg-panel2 hover:text-frost'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-frost2">Risk level</p>
            <div className="grid gap-1.5 sm:grid-cols-3">
              {RISK_OPTIONS.map((option) => (
                <button
                  key={option.id} type="button" onClick={() => setRisk(option.id)} aria-pressed={risk === option.id}
                  className={`rounded-lg border p-2.5 text-left transition-colors ${risk === option.id ? 'border-edge/50 bg-edge/15' : 'border-line bg-panel hover:bg-panel2'}`}
                >
                  <p className={`text-[12px] font-bold ${risk === option.id ? 'text-edge' : 'text-frost'}`}>{option.label}</p>
                  <p className="mt-0.5 text-[9.5px] leading-snug text-frost2">{option.hint}</p>
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[9.5px] leading-snug text-frost2/70">
              Risk preference adjusts which qualifying legs are preferred — it never fabricates confidence or bypasses safety gates.
            </p>
          </div>

          <div>
            <label className="block">
              <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-wider text-frost2">Sportsbook (optional)</span>
              <input
                value={book}
                onChange={(e) => setBook(e.target.value)}
                placeholder="e.g. DraftKings"
                className="min-h-10 w-full rounded-lg border border-line bg-panel px-3 text-[12px] text-head outline-none placeholder:text-muted focus:border-edge/50 focus:ring-2 focus:ring-edge/15"
              />
            </label>
          </div>
        </div>
      </Section>

      <div className="mt-4 rounded-xl border border-line/70 bg-panel/50 p-3">
        <p className="mb-2 font-mono text-[9.5px] uppercase tracking-wider text-frost2">Your request</p>
        <p className="text-[11.5px] leading-relaxed text-frost">{request}</p>
        <button
          type="button"
          onClick={() => onAsk(request)}
          className="mt-3 min-h-11 w-full rounded-lg bg-edge px-4 text-[13px] font-extrabold text-ink transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-edge/50"
        >
          Build this parlay →
        </button>
        {slipCount > 0 && (
          <p className="mt-2 text-center font-mono text-[9.5px] text-frost2">{slipCount} leg{slipCount === 1 ? '' : 's'} already on your slip</p>
        )}
      </div>

      {slipSlot && (
        <div className="mt-4">
          <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-frost2">Your slip</p>
          {slipSlot}
        </div>
      )}
    </div>
  );
}
