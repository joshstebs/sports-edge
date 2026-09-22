import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { Analytics } from '@vercel/analytics/react';
import App from './App';
const ExperienceApp = lazy(() => import('./ExperienceApp'));
import './index.css';

const params = new URLSearchParams(window.location.search);
const experienceMode = params.get('experiences') === '1';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={<div role="status">Loading SportsEdge…</div>}>
      {experienceMode ? <ExperienceApp /> : <App />}
    </Suspense>
    <Analytics />
  </StrictMode>,
);
