import SuggestionChips from './SuggestionChips';

interface EmptyStateProps {
  onPick: (text: string) => void;
}

const FEATURES = [
  {
    label: 'Live data',
    title: 'Real-time feeds',
    text: 'Schedules, stats, availability and market context are checked before a recommendation.',
  },
  {
    label: 'Tracked performance',
    title: 'Every saved pick graded',
    text: 'Results flow into the performance ledger so the model can be audited instead of hand-waved.',
  },
  {
    label: 'Verified provenance',
    title: 'No fabricated lines',
    text: 'When a usable market price cannot be verified, SportsEdge says so instead of inventing one.',
  },
];

export default function EmptyState({ onPick }: EmptyStateProps) {
  return (
    <div className="min-h-full px-4 py-8 sm:px-7 sm:py-12">
      <div className="mx-auto w-full max-w-4xl">
        <div className="mb-8 flex items-center justify-between gap-3">
          <span className="se-live"><span className="se-live-dot" /> Live data</span>
          <span className="se-verified">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3l7 3v5c0 4.6-2.7 8.2-7 10-4.3-1.8-7-5.4-7-10V6l7-3z" />
              <path d="M9 12l2 2 4-5" />
            </svg>
            Verified research
          </span>
        </div>

        <div className="max-w-3xl">
          <p className="se-kicker mb-4">✦ AI-powered betting analysis</p>
          <h2 className="se-hero-title">
            The AI betting analyst that
            <span className="accent">shows its work.</span>
          </h2>
          <p className="mt-5 max-w-2xl text-[15px] leading-7 text-frost sm:text-[17px]">
            Real-time data. Verified lines. Transparent reasoning. <span className="font-semibold text-edge">More edge.</span> Less guesswork.
          </p>
        </div>

        <button
          type="button"
          onClick={() => onPick('What are the best verified bets on today’s slate? Show the evidence, confidence, current price when available, and the main risk for each pick.')}
          className="se-prompt-preview mt-8 flex w-full items-center gap-4 text-left transition hover:border-edge/70 hover:bg-panel/95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-edge/40"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-line-strong text-frost2">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M20 15a4 4 0 01-4 4H8l-5 3 1.5-5A7 7 0 014 5h12a4 4 0 014 4v6z" />
            </svg>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold text-head sm:text-[17px]">Ask SportsEdge for today’s best verified edges</span>
            <span className="mt-1 block text-[11px] leading-relaxed text-frost2">Research first. Pick second. Current data is pulled when you ask.</span>
          </span>
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-edge text-ink shadow-[0_0_20px_rgba(70,223,122,.18)]">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
          </span>
        </button>

        <div className="se-glow-card mt-4 overflow-hidden rounded-2xl p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-full border border-edge/35 bg-edge/10 text-edge">✦</span>
              <div>
                <p className="se-kicker">SportsEdge AI</p>
                <p className="mt-0.5 text-[12px] text-frost2">Grounded analyst workflow</p>
              </div>
            </div>
            <span className="se-grade">A+</span>
          </div>

          <p className="mt-4 text-[15px] font-semibold leading-6 text-head">Every recommendation is built from evidence that the app can show you.</p>
          <div className="se-data-row mt-4">
            <div className="se-data-cell"><span className="label">Line</span><span className="value">Verified</span></div>
            <div className="se-data-cell"><span className="label">Model</span><span className="value cyan">Probability</span></div>
            <div className="se-data-cell"><span className="label">Edge</span><span className="value green">Calculated</span></div>
            <div className="se-data-cell"><span className="label">Risk</span><span className="value">Explained</span></div>
          </div>

          <div className="mt-4 rounded-xl border border-line/70 bg-ink/45 p-3">
            <p className="se-kicker text-sky2">Verified provenance</p>
            <div className="mt-2 flex flex-wrap gap-2 text-[10px] font-semibold text-frost2">
              <span className="rounded-md border border-line px-2 py-1">Live odds source ✓</span>
              <span className="rounded-md border border-line px-2 py-1">Availability ✓</span>
              <span className="rounded-md border border-line px-2 py-1">Recent performance ✓</span>
              <span className="rounded-md border border-line px-2 py-1">Outcome tracking ✓</span>
            </div>
          </div>
        </div>

        <div className="mt-7 grid gap-3 md:grid-cols-3">
          {FEATURES.map((item) => (
            <div key={item.label} className="se-shell-card rounded-xl p-4">
              <p className="se-kicker">{item.label}</p>
              <p className="mt-2 text-[13px] font-semibold text-head">{item.title}</p>
              <p className="mt-1.5 text-[11px] leading-[1.6] text-frost2">{item.text}</p>
            </div>
          ))}
        </div>

        <div className="mt-8 flex items-center justify-between gap-3">
          <p className="se-kicker text-frost2">Quick starts</p>
          <p className="hidden font-mono text-[9px] text-frost2 sm:block">Enter sends · Shift+Enter adds a line</p>
        </div>
        <div className="mt-3"><SuggestionChips onPick={onPick} /></div>

        <p className="se-bottom-legal mt-7">SportsEdge is an analysis tool, not a sportsbook. Verify the current market before placing a wager. Sports betting involves risk; use responsible staking.</p>
      </div>
    </div>
  );
}
