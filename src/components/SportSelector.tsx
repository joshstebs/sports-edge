import type { Sport } from '../types';

interface SportSelectorProps {
  sports: readonly Sport[];
  active: Sport;
  onChange: (s: Sport) => void;
}

export default function SportSelector({ sports, active, onChange }: SportSelectorProps) {
  return (
    <nav className="flex h-10 shrink-0 items-center gap-1 overflow-x-auto border-b border-line bg-ink px-3 sm:px-4" aria-label="Sport scope">
      <span className="mr-1 shrink-0 font-mono text-[9px] font-medium uppercase tracking-[0.12em] text-frost2">Scope</span>
      {sports.map((sport) => {
        const isActive = sport === active;
        return (
          <button
            key={sport}
            type="button"
            onClick={() => onChange(sport)}
            aria-pressed={isActive}
            className={`h-7 shrink-0 rounded-md px-2.5 text-[11px] font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-edge/30 ${
              isActive
                ? 'border border-line-strong bg-panel2 text-head'
                : 'border border-transparent text-frost2 hover:bg-panel hover:text-frost'
            }`}
          >
            {sport}
          </button>
        );
      })}
    </nav>
  );
}
