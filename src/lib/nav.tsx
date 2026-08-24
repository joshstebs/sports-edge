// Application view routing — client-side view state shared by the sidebar and
// mobile bottom navigation.

import type { ReactElement } from 'react';

export type View =
  | 'today'
  | 'chat'
  | 'best-bets'
  | 'parlays'
  | 'my-picks'
  | 'results'
  | 'model-lab';

export interface NavItem {
  id: View;
  label: string;
  /** Short label for mobile bottom bars. */
  short: string;
  icon?: ReactElement;
  adminOnly?: boolean;
}

export function navItems(adminOnly: boolean): NavItem[] {
  const base: Array<Omit<NavItem, 'icon'>> = [
    { id: 'today', label: 'Today', short: 'Home' },
    { id: 'best-bets', label: 'Best Bets', short: 'Picks' },
    { id: 'chat', label: 'Ask SportsEdge', short: 'Ask' },
    { id: 'parlays', label: 'Parlays', short: 'Slip' },
    { id: 'my-picks', label: 'My Picks', short: 'Bets' },
    { id: 'results', label: 'Results', short: 'Results' },
  ];
  if (adminOnly) base.push({ id: 'model-lab', label: 'Model Lab', short: 'Lab', adminOnly: true });
  return base.map((item) => ({ ...item, icon: iconFor(item.id) }));
}

function pathStroke(id: View): { d: string; extra?: string } {
  switch (id) {
    case 'today':
      return { d: 'M3 10.5L12 3l9 7.5', extra: 'M5 9.5V21h14V9.5' };
    case 'best-bets':
      return { d: 'M13 2L4.5 13.5H11L9.5 22 19 9.5h-6.5L13 2z' };
    case 'chat':
      return { d: 'M21 12a8 8 0 01-8 8H4l1.6-3.2A8 8 0 1121 12z' };
    case 'parlays':
      return { d: 'M8 21h12M12 17v4M17 3H7a1 1 0 00-1 1v12a1 1 0 001 1h10a1 1 0 001-1V4a1 1 0 00-1-1z', extra: 'M10 8h4M10 12h4' };
    case 'my-picks':
      return { d: 'M9 12l2 2 4-4', extra: 'M12 3l7 4v5c0 4.5-3 8-7 9-4-1-7-4.5-7-9V7l7-4z' };
    case 'results':
      return { d: 'M3 3v18h18', extra: 'M7 14l3-4 3 3 4-6' };
    case 'model-lab':
      return { d: 'M10 3v4l-5 9a2 2 0 001.8 3h10.4a2 2 0 001.8-3l-5-9V3', extra: 'M8.5 3h7M9 15h6' };
  }
}

export function iconFor(id: View): ReactElement {
  const { d, extra } = pathStroke(id);
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
      {extra && <path d={extra} />}
    </svg>
  );
}
