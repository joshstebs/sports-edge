import type { HealthInfo } from '../lib/api';
import type { AuthUser } from '../lib/auth';
import type { HealthState } from '../types';

interface HeaderProps {
  model: string | null;
  health: HealthState;
  healthInfo: HealthInfo | null;
  user: AuthUser;
  onLogout: () => Promise<void>;
  onNewChat: () => void;
}

function liveTooltip(health: HealthState, info: HealthInfo | null): string {
  if (health !== 'ok' || !info) {
    return 'Live data unavailable — backend /api/health not ok';
  }
  const bits: string[] = [];
  if (info.sources && typeof info.sources === 'object') {
    const keys = Object.keys(info.sources);
    if (keys.length > 0) bits.push(keys.join(', '));
  }
  if (info.version) bits.push(`v${info.version}`);
  return bits.length > 0 ? `Live data feed connected · ${bits.join(' · ')}` : 'Live data feed connected';
}

export default function Header({ model, health, healthInfo, user, onLogout, onNewChat }: HeaderProps) {
  const live = health === 'ok';
  return (
    <header className="z-20 flex shrink-0 items-center justify-between gap-3 border-b border-line/70 bg-ink/85 px-4 py-3 backdrop-blur-xl">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-edge via-edge2 to-teal3 shadow-[0_0_22px_rgba(21,255,194,0.35)]">
          <svg
            viewBox="0 0 24 24"
            className="h-5 w-5 text-ink"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M3 17l5-5 4 3 6-8" />
            <path d="M14 7h4v4" />
          </svg>
        </div>
        <div className="min-w-0">
          <h1 className="font-display truncate text-base font-extrabold tracking-tight text-white">
            SportsEdge
          </h1>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-frost2">AI Betting Analyst</p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2.5">
        {model && (
          <span
            className="hidden rounded-full border border-line/70 bg-panel2/80 px-2.5 py-1 font-mono text-[11px] text-frost sm:inline-block"
            title="Model reported by the live meta event"
          >
            {model}
          </span>
        )}
        <span
          className="flex items-center gap-1.5 rounded-full border border-line/70 bg-panel2/80 px-2.5 py-1 text-[11px] text-frost"
          title={liveTooltip(health, healthInfo)}
        >
          <span className="relative flex h-2 w-2">
            {live && (
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-edge opacity-50" />
            )}
            <span
              className={`relative inline-flex h-2 w-2 rounded-full ${
                live ? 'bg-edge shadow-[0_0_8px_rgba(21,255,194,0.9)]' : 'bg-slate-600'
              }`}
            />
          </span>
          Live data
        </span>
        <button
          type="button"
          onClick={onNewChat}
          className="rounded-full border border-line/70 bg-panel2/80 px-3 py-1 text-[11px] font-semibold text-frost transition hover:border-edge/50 hover:text-edge"
        >
          New chat
        </button>
        <div className="flex items-center gap-2 rounded-full border border-line/70 bg-panel2/80 py-1 pl-1 pr-1 sm:pl-2.5">
          <span className="hidden max-w-28 truncate text-[10px] font-semibold text-frost sm:inline" title={user.username}>
            {user.username}
          </span>
          <span className="hidden rounded-full bg-edge/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-edge md:inline">
            {user.role}
          </span>
          <button
            type="button"
            onClick={() => void onLogout()}
            className="rounded-full px-2 py-0.5 text-[10px] font-semibold text-frost2 transition hover:bg-danger/10 hover:text-danger focus:outline-none focus:ring-2 focus:ring-edge/40"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
