const SUGGESTIONS = [
  "Grade today's best MLB props",
  '4-leg SGP: Blue Jays vs Astros',
  'Compare book odds for Blue Jays vs Astros',
  'Vlad Guerrero Jr. HR prop — full breakdown',
  'Which starters have the best K props?',
];

export default function SuggestionChips({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      {SUGGESTIONS.map((s) => (
        <button
          key={s}
          onClick={() => onPick(s)}
          className="rounded-full border border-line/70 bg-panel2/70 px-3.5 py-2 text-xs font-medium text-frost backdrop-blur transition hover:border-edge/50 hover:bg-edge/10 hover:text-edge hover:shadow-[0_0_14px_rgba(21,255,194,0.12)]"
        >
          {s}
        </button>
      ))}
    </div>
  );
}
