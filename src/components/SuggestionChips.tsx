const SUGGESTIONS = [
  'Best bets today',
  'Build a 5-leg parlay',
  'Best MLB props',
  'Best NFL bets',
  'Best NBA props',
  'Best NHL bets',
];

/**
 * One-tap quick actions for the empty/chat state. Selecting one composes and
 * sends a sensible analyst request automatically.
 */
export default function SuggestionChips({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {SUGGESTIONS.map((suggestion, index) => (
        <button
          key={suggestion}
          type="button"
          onClick={() => onPick(suggestion)}
          className={`group flex min-h-12 items-center gap-3 rounded-lg border border-line bg-panel/70 px-3 py-2.5 text-left hover:border-line-strong hover:bg-panel2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-edge/30 ${index === SUGGESTIONS.length - 1 ? 'sm:col-span-2' : ''}`}
        >
          <span className="font-mono text-[9px] tabular-nums text-frost2">{String(index + 1).padStart(2, '0')}</span>
          <span className="min-w-0 flex-1 text-[12px] font-medium leading-snug text-frost group-hover:text-head">{suggestion}</span>
          <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 shrink-0 text-frost2 group-hover:text-edge" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 10h12M11 5l5 5-5 5" />
          </svg>
        </button>
      ))}
      <p className="text-[10px] leading-relaxed text-frost2/70 sm:col-span-2">
        You can also attach a bet screenshot, ask about injuries, review yesterday’s picks, or ask why a pick was withheld — SportsEdge explains its reasoning on request.
      </p>
    </div>
  );
}
