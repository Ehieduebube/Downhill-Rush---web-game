import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/poppins/latin-600.css';
import '@fontsource/poppins/latin-700.css';
import '@fontsource/poppins/latin-800.css';
import '@fontsource/poppins/latin-900-italic.css';
import App from './App';
import { loadSkaterAsset } from './scene/character/loadSkater';
import './styles.css';

// Start downloading the rider right away (continuing index.html's preload) instead of waiting for
// the 3D scene to mount; on a slow connection it is the largest download. Failures are retried
// and reported by the Skater component.
void loadSkaterAsset().catch(() => undefined);

if (import.meta.env.DEV) {
  // Dev-only debug handle for automated testing; not included in production builds.
  void Promise.all([import('./game/runtime'), import('./game/store'), import('./game/sim')]).then(([rt, st, sim]) => {
    (window as unknown as Record<string, unknown>).__dr = { runtime: rt.runtime, store: st.useGame, sim };
  });
}

const root = document.getElementById('root');
if (!root) throw new Error('Root element missing');

if (import.meta.env.DEV && new URLSearchParams(location.search).has('lab')) {
  // Dev-only character inspection page.
  const rig = new URLSearchParams(location.search).has('rig');
  void (rig ? import('./dev/RigLab') : import('./dev/CharacterLab')).then(({ default: Lab }) => createRoot(root).render(<Lab />));
} else {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
