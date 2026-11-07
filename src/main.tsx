import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/poppins/latin-600.css';
import '@fontsource/poppins/latin-700.css';
import '@fontsource/poppins/latin-800.css';
import '@fontsource/poppins/latin-900-italic.css';
import App from './App';
import './styles.css';

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
