import { StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { Analytics } from '@vercel/analytics/react';
import App from './App';
import './index.css';


createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={<div role="status">Loading SportsEdge…</div>}>
      <App />
    </Suspense>
    <Analytics />
  </StrictMode>,
);
