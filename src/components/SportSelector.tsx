import type { Sport } from '../types';

interface SportSelectorProps {
  sports: readonly Sport[];
  active: Sport;
  onChange: (s: Sport) => void;
}

export default function SportSelector({ sports, active, onChange }: SportSelectorProps) {
  return (
    <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-line/70 bg-ink/60 px-4 py-2">
      <span className="mr-1 text-[10px] font-bold uppercase tracking-[0.18em] text-frost2">Sport</span>
      {sports.map((s) => {
        const isActive = s === active;
        return (
          <button
            key={s}
            onClick={() => onChange(s)}
            className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold transition ${
              isActive
                ? 'border-edge/60 bg-edge/10 text-edge shadow-[0_0_12px_rgba(21,255,194,0.15)]'
                : 'border-line/70 bg-transparent text-frost2 hover:border-edge/40 hover:text-frost'
            }`}
          >
            {s}
          </button>
        );
      })}
    </div>
  );
}
