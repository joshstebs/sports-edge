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
    return 'Live data unavailable - backend /api/health not ok';
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
    <header className="z-20 flex h-12 shrink-0 items-center justify-between gap-3 border-b border-line bg-ink/95 px-3 sm:px-4">
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-edge/25 bg-edge/10 text-edge">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 17l5-5 4 3 6-8" />
            <path d="M14 7h4v4" />
          </svg>
        </div>
        <div className="flex min-w-0 items-baseline gap-2">
          <h1 className="truncate text-[13px] font-semibold tracking-[-0.01em] text-head">SportsEdge</h1>
          <span className="hidden font-mono text-[10px] text-frost2 sm:inline">/ analyst</span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {model && (
          <span className="hidden max-w-40 truncate rounded-md border border-line bg-panel px-2 py-1 font-mono text-[10px] text-frost2 lg:inline-block" title="Model reported by the live meta event">
            {model}
          </span>
        )}
        <span className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[10px] font-medium text-frost2" title={liveTooltip(health, healthInfo)}>
          <span className={`h-1.5 w-1.5 rounded-full ${live ? 'bg-edge' : health === 'checking' ? 'bg-warn' : 'bg-danger'}`} />
          <span className="hidden md:inline">{live ? 'Live data' : health === 'checking' ? 'Checking' : 'Data offline'}</span>
        </span>
        <button type="button" onClick={onNewChat} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-panel px-2.5 text-[11px] font-medium text-frost hover:border-line-strong hover:bg-panel2 hover:text-head focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-edge/30" title="Start a new chat">
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          <span className="hidden sm:inline">New chat</span>
        </button>
        <div className="ml-0.5 flex h-8 items-center gap-2 border-l border-line pl-2">
          <div className="hidden min-w-0 text-right md:block">
            <p className="max-w-28 truncate text-[10px] font-medium leading-none text-frost" title={user.username}>{user.username}</p>
            <p className="mt-1 text-[9px] uppercase tracking-[0.08em] text-frost2">{user.role}</p>
          </div>
          <button type="button" onClick={() => void onLogout()} className="flex h-8 w-8 items-center justify-center rounded-md text-frost2 hover:bg-panel2 hover:text-head focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-edge/30" title="Sign out" aria-label="Sign out">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M10 17l5-5-5-5" />
              <path d="M15 12H3" />
              <path d="M14 3h5a2 2 0 012 2v14a2 2 0 01-2 2h-5" />
            </svg>
          </button>
        </div>
      </div>
    </header>
  );
}
