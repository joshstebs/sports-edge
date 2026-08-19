import type { HealthInfo } from '../lib/api';
import type { AuthUser } from '../lib/auth';
import type { HealthState } from '../types';
import type { ThemeMode } from '../lib/theme';

interface HeaderProps {
  model: string | null;
  health: HealthState;
  healthInfo: HealthInfo | null;
  user: AuthUser;
  theme: ThemeMode;
  onToggleTheme: () => void;
  onLogout: () => Promise<void>;
  onNewChat: () => void;
  onOpenPerformance: () => void;
  onOpenExperience: () => void;
}

function liveTooltip(health: HealthState, info: HealthInfo | null): string {
  if (health !== 'ok' || !info) return 'Live data unavailable — backend /api/health not ok';
  const bits: string[] = [];
  if (info.sources && typeof info.sources === 'object') bits.push(Object.keys(info.sources).join(', '));
  if (info.version) bits.push(`v${info.version}`);
  return bits.length > 0 ? `Live data feed connected · ${bits.join(' · ')}` : 'Live data feed connected';
}

function EdgeMark() {
  return (
    <div className="relative h-7 w-8 shrink-0" aria-hidden="true">
      <span className="absolute left-0 top-0 h-2 w-7 skew-x-[-28deg] rounded-sm bg-edge" />
      <span className="absolute left-1 top-2 h-2 w-6 skew-x-[-28deg] rounded-sm bg-edge2" />
      <span className="absolute left-0 top-4 h-2 w-7 skew-x-[-28deg] rounded-sm bg-edge" />
    </div>
  );
}

export default function Header({
  model,
  health,
  healthInfo,
  user,
  theme,
  onToggleTheme,
  onLogout,
  onNewChat,
  onOpenPerformance,
  onOpenExperience,
}: HeaderProps) {
  const live = health === 'ok';
  return (
    <header className="z-20 flex h-14 shrink-0 items-center justify-between gap-3 border-b border-line/70 bg-ink/90 px-3 backdrop-blur sm:px-4">
      <div className="flex min-w-0 items-center gap-2.5">
        <EdgeMark />
        <div className="flex min-w-0 items-baseline gap-2">
          <h1 className="truncate text-[15px] font-black uppercase tracking-[0.08em] text-head">Sports<span className="text-edge">Edge</span></h1>
          <span className="hidden font-mono text-[9px] uppercase tracking-wider text-frost2 lg:inline">AI Sports Intelligence</span>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {model && (
          <span className="hidden max-w-40 truncate rounded-md border border-line bg-panel px-2 py-1 font-mono text-[10px] text-frost2 xl:inline-block" title="Model reported by the live meta event">{model}</span>
        )}
        <span className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[10px] font-medium text-frost2" title={liveTooltip(health, healthInfo)}>
          <span className={`h-1.5 w-1.5 rounded-full ${live ? 'bg-edge shadow-[0_0_8px_rgba(145,221,185,.6)]' : health === 'checking' ? 'bg-warn' : 'bg-danger'}`} />
          <span className="hidden md:inline">{live ? 'Live' : health === 'checking' ? 'Checking' : 'Offline'}</span>
        </span>

        <button type="button" onClick={onOpenExperience} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-edge/25 bg-edge/5 px-2.5 text-[11px] font-semibold text-edge hover:border-edge/50 hover:bg-edge/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-edge/30" title="Open the 10 new SportsEdge experiences">
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 17h7M17.5 13.5v7"/></svg>
          <span className="hidden sm:inline">Experiences</span>
        </button>

        <button type="button" onClick={onOpenPerformance} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-panel px-2.5 text-[11px] font-medium text-frost hover:border-line-strong hover:bg-panel2 hover:text-head focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-edge/30" title="Model performance dashboard">
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 3v18h18"/><path d="M7 14l3-4 3 3 4-6"/></svg>
          <span className="hidden lg:inline">Performance</span>
        </button>

        <button type="button" onClick={onNewChat} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-panel px-2.5 text-[11px] font-medium text-frost hover:border-line-strong hover:bg-panel2 hover:text-head focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-edge/30" title="Start a new chat">
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
          <span className="hidden sm:inline">New</span>
        </button>

        <button type="button" onClick={onToggleTheme} className="flex h-8 w-8 items-center justify-center rounded-md border border-line bg-panel text-frost2 hover:border-line-strong hover:bg-panel2 hover:text-head focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-edge/30" title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} aria-label="Toggle theme">
          {theme === 'dark' ? (
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
          ) : (
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"/></svg>
          )}
        </button>

        <div className="ml-0.5 flex h-8 items-center gap-2 border-l border-line pl-2">
          <div className="hidden min-w-0 text-right md:block">
            <p className="max-w-28 truncate text-[10px] font-semibold leading-none text-frost" title={user.username}>{user.username}</p>
            <p className="mt-1 text-[9px] uppercase tracking-[0.08em] text-frost2">{user.role}</p>
          </div>
          <button type="button" onClick={() => void onLogout()} className="flex h-8 w-8 items-center justify-center rounded-md text-frost2 hover:bg-panel2 hover:text-head focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-edge/30" title="Sign out" aria-label="Sign out">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/><path d="M14 3h5a2 2 0 012 2v14a2 2 0 01-2 2h-5"/></svg>
          </button>
        </div>
      </div>
    </header>
  );
}
