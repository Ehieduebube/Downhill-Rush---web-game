import { Component, ReactNode, useEffect, useMemo } from 'react';
import { audio } from './game/audio';
import { input } from './game/input';
import { confirmAction, pauseGame, togglePause } from './game/sim';
import { useGame } from './game/store';
import { GameCanvas } from './scene/GameCanvas';
import { HUD, Popups } from './ui/HUD';
import { RunTransition } from './ui/RunTransition';
import { GameOverScreen, PauseScreen, StartScreen } from './ui/Screens';
import { TouchControls } from './ui/TouchControls';

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error('Downhill Rush crashed while rendering:', error);
  }
  render() {
    if (this.state.error) return <Fallback message="Something went wrong while starting the 3D renderer." />;
    return this.props.children;
  }
}

function Fallback({ message }: { message: string }) {
  return (
    <div className="screen modal-screen">
      <div className="panel card">
        <h2 className="card-title">DOWNHILL RUSH</h2>
        <p className="card-sub">{message}</p>
        <p className="hint">Try a recent version of Chrome, Edge, Firefox or Safari with hardware acceleration enabled.</p>
        <div className="card-buttons">
          <button className="btn btn-gold" onClick={() => window.location.reload()}>
            RELOAD
          </button>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const quality = useGame((s) => s.quality);
  const muted = useGame((s) => s.muted);
  const hasWebGL = useMemo(webglAvailable, []);

  useEffect(() => {
    input.attach({
      onPause: () => {
        audio.init();
        togglePause();
      },
      onConfirm: () => confirmAction(),
      onFirstInteraction: () => audio.init(),
    });
    const onVisibility = () => {
      if (document.hidden) pauseGame();
      audio.setSuspended(document.hidden);
    };
    const onBlur = () => pauseGame();
    const onPointer = () => audio.init();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    window.addEventListener('pointerdown', onPointer);
    return () => {
      input.detach();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('pointerdown', onPointer);
    };
  }, []);

  useEffect(() => {
    audio.setMuted(muted);
  }, [muted]);

  if (!hasWebGL) return <Fallback message="Your browser or device does not support WebGL, which this game needs." />;

  return (
    <div className="app">
      <ErrorBoundary>
        <GameCanvas key={quality} quality={quality} />
      </ErrorBoundary>
      <HUD />
      <Popups />
      <TouchControls />
      <StartScreen />
      <PauseScreen />
      <GameOverScreen />
      <RunTransition />
    </div>
  );
}
