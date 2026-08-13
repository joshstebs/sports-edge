import SuggestionChips from './SuggestionChips';

interface EmptyStateProps {
  onPick: (text: string) => void;
}

const FEATURES = [
  {
    dot: 'bg-edge shadow-[0_0_8px_rgba(21,255,194,0.9)]',
    text: 'AI confidence grades — every call scored A–D',
  },
  {
    dot: 'bg-sky2 shadow-[0_0_8px_rgba(72,231,254,0.9)]',
    text: 'Edge math — EV vs implied odds on every leg',
  },
  {
    dot: 'bg-aqua shadow-[0_0_8px_rgba(34,169,236,0.9)]',
    text: 'Live data — Statcast, game logs, weather & odds. Never vibes.',
  },
];

export default function EmptyState({ onPick }: EmptyStateProps) {
  return (
    <div className="flex min-h-full flex-col items-center justify-center px-4 py-10 text-center">
      <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-edge via-edge2 to-teal3 shadow-[0_0_30px_rgba(21,255,194,0.35)]">
        <svg
          viewBox="0 0 24 24"
          className="h-8 w-8 text-ink"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M3 17l5-5 4 3 6-8" />
          <path d="M14 7h4v4" />
        </svg>
      </div>
      <h2 className="font-display bg-gradient-to-br from-white via-[#eafef8] to-edge bg-clip-text text-3xl font-extrabold tracking-tight text-transparent sm:text-4xl">
        Find the edge. Not the guess.
      </h2>
      <p className="mt-3 max-w-xl text-sm leading-relaxed text-frost">
        Every prop, parlay, and +EV call is built on live Statcast, game logs, weather, and odds — never
        vibes.
      </p>
      <ul className="mt-7 space-y-2.5 text-left">
        {FEATURES.map((f) => (
          <li key={f.text} className="flex items-center gap-2.5 text-sm text-frost">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${f.dot}`} />
            {f.text}
          </li>
        ))}
      </ul>
      <div className="mt-8 w-full max-w-2xl">
        <SuggestionChips onPick={onPick} />
      </div>
      <p className="mt-10 text-[11px] text-frost2/70">
        For entertainment only. Sports betting involves risk. We encourage fractional unit sizing and
        responsible play.
      </p>
    </div>
  );
}
