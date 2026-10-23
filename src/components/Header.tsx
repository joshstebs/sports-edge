import { type FormEvent } from 'react';
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
  onOpenExperience?: () => void;
  onSearch: (query: string) => void;
  onOpenSlip: () => void;
  slipCount: number;
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
    <div className="relative h-7 w-8 shrink-0 min-w-[32px]" aria-hidden="true">
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
  onSearch,
  onOpenSlip,
  slipCount,
}: HeaderProps) {
  const live = health === 'ok';
  const openExperiences = () => {
    if (onOpenExperience) {
      onOpenExperience();
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set('experiences', '1');
    window.location.href = url.toString();
  };

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    onSearch(String(data.get('q') ?? ''));
  };

  return (
    <header className="z-20 shrink-0 border-b border-line bg-ink">
      <div className="flex h-14 items-center gap-2 px-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-2 md:hidden">
          <EdgeMark />
          <h1 className="display truncate text-xl text-head">Sports<span className="text-edge">Edge</span></h1>
        </div>
        <form className="hidden min-w-0 flex-1 md:block" role="search" onSubmit={submitSearch}>
          <label className="sr-only" htmlFor="global-search">Search screens or a player</label>
          <input id="global-search" name="q" type="search" placeholder="Screen or player" className="h-11 w-full border border-line bg-panel px-3 text-sm text-head placeholder:text-frost2" />
        </form>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {model && (
            <span className="hidden max-w-40 truncate border border-line px-2 py-1 font-mono text-[10px] text-frost2 xl:inline-block" title="Model reported by the live meta event">{model}</span>
          )}
          <span className="inline-flex h-11 items-center gap-1.5 px-1 text-[10px] font-medium text-frost2" title={liveTooltip(health, healthInfo)}>
            <span className={`h-1.5 w-1.5 rounded-full ${live ? 'bg-edge' : health === 'checking' ? 'bg-warn' : 'bg-danger'}`} />
            <span className="hidden md:inline">{live ? 'Live' : health === 'checking' ? 'Checking' : 'Offline'}</span>
          </span>
          <button type="button" onClick={onOpenSlip} className="hidden h-11 items-center border border-line px-2 text-[11px] font-semibold text-frost hover:text-head sm:inline-flex" aria-label="Open parlay slip">
            Slip{slipCount > 0 && <span className="num ml-1 text-edge">{slipCount}</span>}
          </button>
          <button type="button" onClick={openExperiences} className="hidden h-11 items-center border border-line px-2 text-[11px] font-semibold text-frost hover:text-head lg:inline-flex">Experiences</button>
          <button type="button" onClick={onOpenPerformance} className="hidden h-11 w-11 items-center justify-center border border-line text-frost hover:text-head lg:inline-flex" title="Model performance" aria-label="Open results">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M3 3v18h18"/><path d="M7 14l3-4 3 3 4-6"/></svg>
          </button>
          <button type="button" onClick={onNewChat} className="inline-flex h-11 w-11 items-center justify-center border border-line text-frost hover:text-head" title="Start a new chat" aria-label="New chat">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
          </button>
          <button type="button" onClick={onToggleTheme} className="flex h-11 w-11 items-center justify-center border border-line text-frost2 hover:text-head" title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} aria-label="Toggle theme">
            {theme === 'dark' ? (
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2"/></svg>
            ) : (
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"/></svg>
            )}
          </button>
          <div className="hidden min-w-0 text-right md:block">
            <p className="max-w-28 truncate text-[10px] font-semibold leading-none text-frost" title={user.username}>{user.username}</p>
            <p className="mt-1 text-[9px] uppercase tracking-[0.08em] text-frost2">{user.role}</p>
          </div>
          <button type="button" onClick={() => void onLogout()} className="flex h-11 w-11 items-center justify-center text-frost2 hover:bg-panel2 hover:text-head" title="Sign out" aria-label="Sign out">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true"><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/><path d="M14 3h5a2 2 0 012 2v14a2 2 0 01-2 2h-5"/></svg>
          </button>
        </div>
      </div>
      <form className="px-3 pb-3 md:hidden" role="search" onSubmit={submitSearch}>
        <label className="sr-only" htmlFor="global-search-mobile">Search screens or a player</label>
        <input id="global-search-mobile" name="q" type="search" placeholder="Screen or player" className="h-11 w-full border border-line bg-panel px-3 text-sm text-head placeholder:text-frost2" />
      </form>
    </header>
  );
}
