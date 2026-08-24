import { iconFor, navItems, type View } from '../lib/nav';
import type { AuthUser } from '../lib/auth';

interface SidebarProps {
  user: AuthUser;
  view: View;
  onNavigate: (view: View) => void;
  slipCount: number;
}

export default function Sidebar({ user, view, onNavigate, slipCount }: SidebarProps) {
  const items = navItems(user.role === 'admin');
  return (
    <nav
      aria-label="Primary"
      className="hidden w-56 shrink-0 flex-col gap-0.5 border-r border-line/70 bg-ink/70 px-2.5 py-4 md:flex"
    >
      {items.map((item) => {
        const active = view === item.id;
        const showBadge = item.id === 'parlays' && slipCount > 0;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onNavigate(item.id)}
            aria-current={active ? 'page' : undefined}
            className={`group flex min-h-10 items-center gap-3 rounded-lg px-3 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-edge/40 ${
              active
                ? 'bg-edge/12 text-edge'
                : 'text-frost hover:bg-panel2 hover:text-head'
            }`}
          >
            <span className={`h-4.5 w-4.5 shrink-0 ${active ? 'text-edge' : 'text-frost2 group-hover:text-frost'}`}>
              {item.icon}
            </span>
            <span className="flex-1 text-left">{item.label}</span>
            {showBadge && (
              <span className="rounded-full bg-edge px-1.5 py-0.5 font-mono text-[10px] font-bold leading-none text-ink">
                {slipCount}
              </span>
            )}
          </button>
        );
      })}
      <div className="mt-auto px-3 pt-3">
        <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-frost2/60">Verified data only</p>
        <p className="mt-1 text-[10px] leading-snug text-frost2/50">
          Picks require real odds and verified evidence. When evidence is missing, SportsEdge withholds.
        </p>
      </div>
    </nav>
  );
}

export { iconFor };
