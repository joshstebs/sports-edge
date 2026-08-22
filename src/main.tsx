import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Analytics } from '@vercel/analytics/react';
import App from './App';
import ExperienceApp from './ExperienceApp';
import './index.css';

const params = new URLSearchParams(window.location.search);
const experienceMode = params.get('experiences') === '1';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {experienceMode ? <ExperienceApp /> : <App />}
    <Analytics />
  </StrictMode>,
);