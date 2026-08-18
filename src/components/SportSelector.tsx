import type { SportMeta } from '../types';

interface SportSelectorProps {
  sports: readonly SportMeta[];
  active: SportMeta['code'] | 'All';
  onChange: (s: SportMeta['code'] | 'All') => void;
}

export default function SportSelector({ sports, active, onChange }: SportSelectorProps) {
  return (
    <nav
      className="flex h-11 shrink-0 items-center gap-1.5 overflow-x-auto border-b border-line/70 bg-ink/80 px-3 sm:px-4"
      aria-label="Sport scope"
    >
      <span className="mr-0.5 hidden shrink-0 font-mono text-[9px] font-semibold uppercase tracking-[0.14em] text-frost2 sm:inline">
        Leagues
      </span>
      {sports.map((sport) => {
        const isActive = sport.code === active;
        const planned = sport.status === 'planned';
        return (
          <button
            key={sport.code}
            type="button"
            onClick={() => onChange(sport.code)}
            aria-pressed={isActive}
            title={planned ? `${sport.label} — coming soon` : sport.label}
            className={`group relative flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-edge/30 ${
              isActive
                ? 'border border-edge/40 bg-edge/10 text-head'
                : 'border border-transparent text-frost2 hover:bg-panel hover:text-frost'
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${isActive ? 'bg-edge' : planned ? 'bg-frost2/40' : 'bg-edge2/70'}`}
              aria-hidden="true"
            />
            {sport.label}
            {planned && (
              <span className="ml-0.5 rounded bg-panel2 px-1 py-px text-[8px] font-medium uppercase tracking-wide text-frost2">
                soon
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}
