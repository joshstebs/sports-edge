import { navItems, type View } from '../lib/nav';
import type { AuthUser } from '../lib/auth';

interface SidebarProps {
  user: AuthUser;
  view: View;
  onNavigate: (view: View) => void;
  slipCount: number;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

export default function Sidebar({ user, view, onNavigate, slipCount, collapsed, onToggleCollapsed }: SidebarProps) {
  const items = navItems(user.role === 'admin');
  return (
    <nav
      aria-label="Primary"
      className={`hidden shrink-0 flex-col border-r border-line bg-ink md:flex ${collapsed ? 'w-[4.5rem]' : 'w-56'}`}
    >
      <div className={`flex items-center ${collapsed ? 'justify-center px-2' : 'justify-between px-3'} h-14 border-b border-line`}>
        {!collapsed && <span className="display text-lg text-head">Sports<span className="text-edge">Edge</span></span>}
        <button type="button" onClick={onToggleCollapsed} className="flex h-11 w-11 items-center justify-center text-frost2 hover:text-head" aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}>
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d={collapsed ? 'M9 6l6 6-6 6' : 'M15 6l-6 6 6 6'} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 py-3">
        {items.map((item) => {
          const active = view === item.id;
          const showBadge = item.id === 'parlays' && slipCount > 0;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onNavigate(item.id)}
              aria-current={active ? 'page' : undefined}
              aria-label={item.label}
              title={item.label}
              className={`flex min-h-11 items-center gap-3 px-2 text-left text-[13px] font-medium ${
                active ? 'bg-edge/12 text-edge' : 'text-frost hover:bg-panel2 hover:text-head'
              } ${collapsed ? 'justify-center' : ''}`}
            >
              <span className="h-4 w-4 shrink-0">{item.icon}</span>
              {!collapsed && <span className="flex-1">{item.label}</span>}
              {!collapsed && showBadge && (
                <span className="bg-edge px-1.5 py-0.5 font-mono text-[10px] font-bold leading-none text-ink">{slipCount}</span>
              )}
            </button>
          );
        })}
      </div>
      {!collapsed && (
        <p className="px-4 pb-4 text-[11px] leading-snug text-frost2">Picks need a stored price and evidence. Missing evidence is withheld.</p>
      )}
    </nav>
  );
}
