import SuggestionChips from './SuggestionChips';

interface EmptyStateProps {
  onPick: (text: string) => void;
}

const CAPABILITIES = [
  {
    label: 'Evidence',
    title: 'Live-source grounding',
    text: 'Stats, odds, schedule, weather and availability are fetched before analysis.',
  },
  {
    label: 'Model',
    title: 'Edge before opinion',
    text: 'Probability, implied price and model edge stay separate from the language model.',
  },
  {
    label: 'Safety',
    title: 'Fail closed',
    text: 'Unavailable or unverifiable data is withheld instead of filled with guesses.',
  },
];

export default function EmptyState({ onPick }: EmptyStateProps) {
  return (
    <div className="flex min-h-full items-center px-4 py-7 sm:px-8 sm:py-10">
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-5 flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md border border-edge/20 bg-edge/10 text-edge">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 17l5-5 4 3 6-8" />
              <path d="M14 7h4v4" />
            </svg>
          </div>
          <span className="font-mono text-[9px] font-medium uppercase tracking-[0.14em] text-frost2">SportsEdge / live research</span>
        </div>

        <h2 className="max-w-2xl text-2xl font-semibold tracking-[-0.035em] text-head sm:text-[30px]">What are we analyzing?</h2>
        <p className="mt-2 max-w-2xl text-[13px] leading-6 text-frost">
          Ask for a matchup, prop, parlay, or screenshot review. SportsEdge verifies the event and evidence first, then explains the edge.
        </p>

        <div className="mt-6 grid overflow-hidden rounded-lg border border-line bg-panel/45 sm:grid-cols-3">
          {CAPABILITIES.map((item, index) => (
            <div key={item.label} className={`p-3.5 ${index > 0 ? 'border-t border-line sm:border-l sm:border-t-0' : ''}`}>
              <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-edge">{item.label}</p>
              <p className="mt-1.5 text-[12px] font-semibold text-head">{item.title}</p>
              <p className="mt-1 text-[11px] leading-[1.55] text-frost2">{item.text}</p>
            </div>
          ))}
        </div>

        <div className="mt-6 flex items-center justify-between gap-3">
          <p className="font-mono text-[9px] font-medium uppercase tracking-[0.12em] text-frost2">Quick starts</p>
          <p className="hidden font-mono text-[9px] text-frost2 sm:block">Enter sends · Shift+Enter adds a line</p>
        </div>
        <div className="mt-2.5">
          <SuggestionChips onPick={onPick} />
        </div>

        <p className="mt-5 text-[10px] leading-relaxed text-frost2/70">For entertainment only. Sports betting involves risk. Use fractional units and verify the current market before placing any wager.</p>
      </div>
    </div>
  );
}
