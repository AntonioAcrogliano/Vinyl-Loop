import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import '@fontsource-variable/inter';
import '@fontsource-variable/bricolage-grotesque';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Offline support (production only: in dev it would fight with Vite's HMR).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', async () => {
    try {
      await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`);
      const reg = await navigator.serviceWorker.ready;
      // Hand over what was loaded before the worker controlled the page.
      const urls = performance
        .getEntriesByType('resource')
        .map((e) => e.name)
        .filter((u) => new URL(u).origin === location.origin);
      reg.active?.postMessage({ type: 'cache', urls });
    } catch {
      // No offline support; the app works the same online.
    }
  });
}
