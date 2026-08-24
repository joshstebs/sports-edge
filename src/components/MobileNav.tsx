import { navItems, type View } from '../lib/nav';
import type { AuthUser } from '../lib/auth';

interface MobileNavProps {
  user: AuthUser;
  view: View;
  onNavigate: (view: View) => void;
  slipCount: number;
}

/** Mobile bottom navigation. Five primary destinations; safe-area aware. */
export default function MobileNav({ user, view, onNavigate, slipCount }: MobileNavProps) {
  // Fixed five slots on mobile per design: Home, Picks, Ask (center), Slip, Results.
  const mobileOrder: Array<View> = ['today', 'best-bets', 'chat', 'parlays', 'results'];
  const items = navItems(user.role === 'admin').filter((item) => mobileOrder.includes(item.id));

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line/80 bg-ink/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
    >
      <div className="mx-auto flex max-w-lg items-stretch justify-around px-1">
        {items.map((item) => {
          const active = view === item.id;
          const isAsk = item.id === 'chat';
          const showBadge = item.id === 'parlays' && slipCount > 0;

          if (isAsk) {
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                aria-current={active ? 'page' : undefined}
                aria-label="Ask SportsEdge"
                className="relative -mt-4 flex w-16 flex-col items-center focus-visible:outline-none"
              >
                <span
                  className={`flex h-12 w-12 items-center justify-center rounded-full border shadow-[0_6px_18px_rgba(21,255,194,0.25)] transition-colors ${
                    active
                      ? 'border-edge bg-edge text-ink'
                      : 'border-edge/50 bg-panel2 text-edge'
                  }`}
                >
                  <svg viewBox="0 0 24 24" className="h-5.5 w-5.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 17l5-5 4 3 6-8" />
                    <path d="M14 7h4v4" />
                  </svg>
                </span>
                <span className={`mt-0.5 text-[10px] font-semibold ${active ? 'text-edge' : 'text-frost2'}`}>Ask</span>
              </button>
            );
          }

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.id)}
              aria-current={active ? 'page' : undefined}
              className={`relative flex min-h-[56px] w-16 flex-col items-center justify-center gap-1 pt-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-edge/40 ${
                active ? 'text-edge' : 'text-frost2'
              }`}
            >
              <span className="h-5 w-5">{item.icon}</span>
              <span className="text-[10px] font-medium leading-none">{item.short}</span>
              {showBadge && (
                <span className="absolute right-2 top-1 rounded-full bg-edge px-1.5 py-0.5 font-mono text-[9px] font-bold leading-none text-ink">
                  {slipCount}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
