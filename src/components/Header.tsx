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
}

function liveTooltip(health: HealthState, info: HealthInfo | null): string {
  if (health !== 'ok' || !info) return 'Live data unavailable — backend /api/health not ok';
  const bits: string[] = [];
  if (info.sources && typeof info.sources === 'object') bits.push(Object.keys(info.sources).join(', '));
  if (info.version) bits.push(`v${info.version}`);
  return bits.length > 0 ? `Live data feed connected · ${bits.join(' · ')}` : 'Live data feed connected';
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
}: HeaderProps) {
  const live = health === 'ok';

  return (
    <header className="z-30 shrink-0 border-b border-line/70 bg-ink/90 backdrop-blur-xl">
      <div className="mx-auto flex min-h-16 w-full max-w-7xl items-center justify-between gap-3 px-3 py-2 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <div className="se-logo-mark" aria-hidden="true"><span /></div>
          <div className="min-w-0">
            <h1 className="se-logo-word text-[15px] sm:text-[18px]">Sports<em>Edge</em></h1>
            <p className="mt-0.5 hidden font-mono text-[8px] uppercase tracking-[0.13em] text-frost2 sm:block">AI sports intelligence</p>
          </div>
        </div>

        <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
          <span className={`se-live hidden sm:inline-flex ${live ? '' : 'opacity-60'}`} title={liveTooltip(health, healthInfo)}>
            <span className={`se-live-dot ${live ? '' : health === 'checking' ? 'bg-warn' : 'bg-danger'}`} />
            {live ? 'Live data' : health === 'checking' ? 'Checking' : 'Offline'}
          </span>
          <span className="se-verified hidden lg:inline-flex" title="Recommendations only display sportsbook prices when the app has a verified price source">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3l7 3v5c0 4.6-2.7 8.2-7 10-4.3-1.8-7-5.4-7-10V6l7-3z" /><path d="M9 12l2 2 4-5" /></svg>
            Verified lines
          </span>

          {model && (
            <span className="hidden max-w-36 truncate rounded-lg border border-line bg-panel/70 px-2.5 py-2 font-mono text-[9px] text-frost2 xl:inline-block" title="Model reported by the live meta event">
              {model}
            </span>
          )}

          <button
            type="button"
            onClick={onOpenPerformance}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-panel/65 px-2.5 text-[10px] font-bold uppercase tracking-[0.08em] text-frost hover:border-edge/35 hover:text-edge focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-edge/30"
            title="Model performance dashboard"
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 3v18h18" /><path d="M7 14l3-4 3 3 4-6" /></svg>
            <span className="hidden md:inline">Analytics</span>
          </button>

          <button
            type="button"
            onClick={onNewChat}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-panel/65 px-2.5 text-[10px] font-bold uppercase tracking-[0.08em] text-frost hover:border-edge/35 hover:text-edge focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-edge/30"
            title="Start a new analysis"
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
            <span className="hidden sm:inline">New</span>
          </button>

          <button
            type="button"
            onClick={onToggleTheme}
            className="hidden h-9 w-9 items-center justify-center rounded-lg border border-line bg-panel/65 text-frost2 hover:border-edge/35 hover:text-edge md:flex"
            title={theme === 'dark' ? 'Theme control' : 'Theme control'}
            aria-label="Toggle theme"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /><circle cx="12" cy="12" r="4" /></svg>
          </button>

          <div className="ml-0.5 flex items-center gap-2 border-l border-line/80 pl-2">
            <div className="hidden min-w-0 text-right xl:block">
              <p className="max-w-28 truncate text-[10px] font-semibold leading-none text-frost" title={user.username}>{user.username}</p>
              <p className="mt-1 text-[8px] uppercase tracking-[0.1em] text-frost2">{user.role}</p>
            </div>
            <button
              type="button"
              onClick={() => void onLogout()}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-panel/60 text-frost2 hover:border-edge/35 hover:text-edge focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-edge/30"
              title="Sign out"
              aria-label="Sign out"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="3.2" /><path d="M5.5 20c.8-4 3-6 6.5-6s5.7 2 6.5 6" /></svg>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
