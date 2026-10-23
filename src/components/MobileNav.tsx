import { useState } from 'react';
import { navItems, type View } from '../lib/nav';
import type { AuthUser } from '../lib/auth';

interface MobileNavProps {
  user: AuthUser;
  view: View;
  onNavigate: (view: View) => void;
  slipCount: number;
}

const PRIMARY: View[] = ['today', 'best-bets', 'research', 'chat'];

export default function MobileNav({ user, view, onNavigate, slipCount }: MobileNavProps) {
  const [more, setMore] = useState(false);
  const items = navItems(user.role === 'admin');
  const primary = PRIMARY.map((id) => items.find((item) => item.id === id)).filter((item): item is NonNullable<typeof item> => Boolean(item));
  const overflow = items.filter((item) => !PRIMARY.includes(item.id));
  const moreActive = overflow.some((item) => item.id === view);

  return (
    <>
      {more && (
        <div className="fixed inset-0 z-40 md:hidden" role="presentation">
          <button type="button" className="absolute inset-0 bg-ink/70" aria-label="Close menu" onClick={() => setMore(false)} />
          <div role="dialog" aria-label="More destinations" className="absolute inset-x-0 bottom-0 border-t border-line bg-panel pb-[calc(4.5rem+env(safe-area-inset-bottom))]">
            <div className="mx-auto grid max-w-lg grid-cols-2 gap-px bg-line">
              {overflow.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => { onNavigate(item.id); setMore(false); }}
                  className={`flex min-h-14 items-center gap-2 bg-panel px-4 text-left text-sm font-semibold ${view === item.id ? 'text-edge' : 'text-head'}`}
                >
                  <span className="h-4 w-4">{item.icon}</span>
                  {item.label}
                  {item.id === 'parlays' && slipCount > 0 ? <span className="num ml-auto text-edge">{slipCount}</span> : null}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
      <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-ink pb-[env(safe-area-inset-bottom)] md:hidden">
        <div className="mx-auto flex max-w-lg items-stretch">
          {primary.map((item) => {
            const active = view === item.id;
            return (
              <button key={item.id} type="button" onClick={() => { setMore(false); onNavigate(item.id); }} aria-current={active ? 'page' : undefined} className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-1 text-[10px] font-semibold ${active ? 'text-edge' : 'text-frost2'}`}>
                <span className="h-5 w-5">{item.icon}</span>
                {item.short}
              </button>
            );
          })}
          <button type="button" onClick={() => setMore((open) => !open)} aria-expanded={more} className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-1 text-[10px] font-semibold ${moreActive || more ? 'text-edge' : 'text-frost2'}`}>
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M5 7h14M5 12h14M5 17h14" strokeLinecap="round" /></svg>
            More
            {slipCount > 0 && <span className="sr-only">{slipCount} legs on the slip</span>}
          </button>
        </div>
      </nav>
    </>
  );
}
