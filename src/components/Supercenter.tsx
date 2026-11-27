import { useState } from 'react';
import type { AuthUser } from '../lib/auth';
import type { View } from '../lib/nav';
import OddsBoard from './OddsBoard';
import ResearchDesk from './ResearchDesk';
import PropLearningPanel from './PropLearningPanel';
import Results from './Results';
import MyPicks from './MyPicks';
import ResearchWorkspace from './ResearchWorkspace';

const sections = [
  { id: 'odds', label: 'Odds' },
  { id: 'props', label: 'Player research' },
  { id: 'edge', label: 'Edge analysis' },
  { id: 'performance', label: 'Model results' },
  { id: 'picks', label: 'My picks' },
  { id: 'connections', label: 'BetTrack & BetIQ', adminOnly: true },
] as const;

type Section = typeof sections[number]['id'];

export default function Supercenter({ user, onAsk, onNavigate }: {
  user: AuthUser;
  onAsk: (prompt: string) => void;
  onNavigate: (view: View) => void;
}) {
  const [section, setSection] = useState<Section>('odds');
  const admin = user.role === 'admin';

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 px-4 py-6 sm:px-8">
      <header className="border-b border-line pb-4">
        <h1 className="text-3xl font-semibold text-head sm:text-4xl">Sports Betting Supercenter</h1>
      </header>
      <nav className="flex flex-wrap gap-2" aria-label="Supercenter sections">
        {sections.filter(item => !('adminOnly' in item) || admin).map(({ id, label }) => (
          <button key={id} type="button" aria-current={section === id ? 'page' : undefined}
            onClick={() => setSection(id)}
            className="min-h-10 rounded-lg border border-line bg-panel px-3 text-sm font-semibold text-frost hover:text-head aria-[current=page]:border-edge aria-[current=page]:text-edge">
            {label}
          </button>
        ))}
      </nav>
      {section === 'odds' && <OddsBoard />}
      {section === 'props' && <ResearchDesk onAsk={onAsk} userId={user.id} />}
      {section === 'edge' && (
        <div className="space-y-4">
          {admin && <PropLearningPanel />}
          <button type="button" onClick={() => onNavigate('best-bets')}
            className="min-h-10 rounded-lg border border-line bg-panel px-3 text-sm font-semibold text-head hover:border-edge">
            Open Edge Desk
          </button>
        </div>
      )}
      {section === 'performance' && <Results />}
      {section === 'picks' && <MyPicks />}
      {section === 'connections' && admin && <ResearchWorkspace onAsk={onAsk} />}
    </div>
  );
}
