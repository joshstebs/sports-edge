import { useState } from 'react';
import type { PlayerResearchObservation } from '../lib/api';

type Side = 'over' | 'under';

function statusFor(value: number, line: number | null, side: Side): 'hit' | 'miss' | 'push' | 'open' {
  if (line == null || !Number.isFinite(line)) return 'open';
  if (value === line) return 'push';
  const hit = side === 'over' ? value > line : value < line;
  return hit ? 'hit' : 'miss';
}

const TONE = {
  hit: 'var(--color-edge)',
  miss: 'var(--color-danger)',
  push: 'var(--color-warn)',
  open: 'var(--color-frost2)',
} as const;

export default function PropTrendChart({
  games,
  line,
  side,
  marketLabel,
}: {
  games: PlayerResearchObservation[];
  line: number | null;
  side: Side;
  marketLabel: string;
}) {
  const [active, setActive] = useState<number | null>(null);
  const chronological = [...games].reverse();
  if (!chronological.length) {
    return <p className="text-sm text-frost2">No published games in this window.</p>;
  }
  const values = chronological.map((game) => game.value);
  const ceiling = Math.max(...values, line ?? 0, 1);
  const width = 640;
  const height = 220;
  const pad = { top: 16, right: 12, bottom: 28, left: 36 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const gap = chronological.length > 12 ? 4 : 8;
  const barW = Math.max(6, (innerW - gap * (chronological.length - 1)) / chronological.length);
  const y = (value: number) => pad.top + innerH - (value / ceiling) * innerH;
  const current = active != null ? chronological[active] : null;
  const currentStatus = current ? statusFor(current.value, line, side) : null;

  return (
    <figure className="min-w-0">
      <figcaption className="mb-2 flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="kicker">Historical results</p>
          <p className="mt-1 text-sm text-frost">Not a forecast. Each bar is one published game.</p>
        </div>
        <ul className="flex flex-wrap gap-3 text-[11px] text-frost2">
          <li className="flex items-center gap-1.5"><span className="h-2 w-2 bg-edge" /> Hit</li>
          <li className="flex items-center gap-1.5"><span className="h-2 w-2 bg-danger" /> Miss</li>
          <li className="flex items-center gap-1.5"><span className="h-2 w-2 bg-warn" /> Push</li>
          {line != null && <li className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-head" /> Line {line}</li>}
        </ul>
      </figcaption>
      <div className="overflow-x-auto border border-line bg-panel/50">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${marketLabel} over the selected games`} className="h-56 w-full min-w-[320px]">
          {[0, 0.5, 1].map((step) => {
            const value = ceiling * step;
            const yy = y(value);
            return (
              <g key={step}>
                <line x1={pad.left} x2={width - pad.right} y1={yy} y2={yy} stroke="var(--color-line)" strokeWidth="1" />
                <text x={pad.left - 6} y={yy + 3} textAnchor="end" fill="var(--color-frost2)" fontSize="10" fontFamily="ui-monospace, monospace">{value.toFixed(value >= 10 ? 0 : 1)}</text>
              </g>
            );
          })}
          {line != null && Number.isFinite(line) && (
            <line x1={pad.left} x2={width - pad.right} y1={y(line)} y2={y(line)} stroke="var(--color-head)" strokeDasharray="4 3" strokeWidth="1.25" />
          )}
          {chronological.map((game, index) => {
            const tone = TONE[statusFor(game.value, line, side)];
            const x = pad.left + index * (barW + gap);
            const top = y(game.value);
            const barH = Math.max(2, pad.top + innerH - top);
            const selected = active === index;
            return (
              <g key={`${game.gameId ?? game.date ?? index}`}>
                <rect
                  x={x}
                  y={top}
                  width={barW}
                  height={barH}
                  fill={tone}
                  opacity={selected || active == null ? 1 : 0.45}
                />
                <rect
                  x={x - 2}
                  y={pad.top}
                  width={barW + 4}
                  height={innerH}
                  fill="transparent"
                  tabIndex={0}
                  role="button"
                  aria-label={`${game.date?.slice(0, 10) ?? 'Unpublished date'}, ${game.value} ${marketLabel}${game.opponent ? ` vs ${game.opponent}` : ''}`}
                  onFocus={() => setActive(index)}
                  onBlur={() => setActive((cur) => (cur === index ? null : cur))}
                  onMouseEnter={() => setActive(index)}
                  onMouseLeave={() => setActive((cur) => (cur === index ? null : cur))}
                  className="cursor-pointer"
                />
              </g>
            );
          })}
        </svg>
      </div>
      <p className="mt-2 min-h-10 text-sm text-frost2" aria-live="polite">
        {current ? (
          <>
            <span className="num text-head">{current.value}</span> {marketLabel}
            {' · '}{current.date?.slice(0, 10) ?? 'Date unpublished'}
            {current.opponent ? ` · ${current.opponent}` : ''}
            {current.result ? ` · ${current.result}` : ''}
            {currentStatus && currentStatus !== 'open' ? ` · ${currentStatus}` : ''}
          </>
        ) : (
          'Select a bar for the game, opponent and result.'
        )}
      </p>
    </figure>
  );
}
