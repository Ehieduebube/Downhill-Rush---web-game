import { useMemo } from 'react';
import { goToMenu, restartGame, resumeGame, startGame, toggleMute } from '../game/sim';
import { isRiderPending, isTouchDevice, useGame } from '../game/store';
import { audio } from '../game/audio';
import { CoinIcon, SoundIcon } from './icons';

const fmt = (n: number) => Math.floor(n).toLocaleString('en-US');

function Key({ children }: { children: React.ReactNode }) {
  return <kbd className="key">{children}</kbd>;
}

function SettingsBar() {
  const muted = useGame((s) => s.muted);
  const quality = useGame((s) => s.quality);
  const setQuality = useGame((s) => s.setQuality);
  return (
    <div className="settings">
      <button className="chip-btn" onClick={() => toggleMute()} aria-label={muted ? 'Unmute' : 'Mute'}>
        <span className="chip-icon">
          <SoundIcon muted={muted} />
        </span>
        {muted ? 'Sound off' : 'Sound on'}
      </button>
      <button
        className="chip-btn"
        onClick={() => {
          audio.init();
          audio.click();
          setQuality(quality === 'high' ? 'low' : 'high');
        }}
        aria-label="Toggle graphics quality"
      >
        Graphics: {quality === 'high' ? 'High' : 'Low'}
      </button>
    </div>
  );
}

export function StartScreen() {
  const phase = useGame((s) => s.phase);
  const best = useGame((s) => s.best);
  const bank = useGame((s) => s.bank);
  const characterError = useGame((s) => s.characterError);
  const loading = useGame(isRiderPending);
  const progress = useGame((s) => Math.round(s.characterProgress * 100));
  const touch = useMemo(() => isTouchDevice(), []);
  if (phase !== 'menu') return null;
  return (
    <div className="screen start-screen">
      <SettingsBar />
      <div className="title-block">
        <h1 className="title">
          <span className="title-line">DOWNHILL</span>
          <span className="title-line title-rush">RUSH</span>
        </h1>
        <p className="subtitle">Ride the endless descent.</p>
        {characterError && <p className="hint notice">The skater model could not be loaded - reload the page to try again.</p>}
      </div>
      <div className="start-center">
        <button
          className={loading ? 'btn btn-play is-loading' : 'btn btn-play'}
          onClick={() => startGame()}
          disabled={loading}
          aria-busy={loading}
          aria-label={loading ? `Loading the skater, ${progress}%` : 'Play'}
        >
          {loading ? `LOADING ${progress}%` : 'PLAY'}
        </button>
        <div className="stat-row">
          <div className="panel stat-chip">
            <span className="stat-label">BEST</span>
            <span className="stat-value">{fmt(best)}</span>
          </div>
          <div className="panel stat-chip">
            <CoinIcon size="1.3em" />
            <span className="stat-value">{fmt(bank)}</span>
          </div>
        </div>
      </div>
      <div className="panel controls-guide">
        {touch ? (
          <div className="guide-grid">
            <span>◀ ▶</span>
            <span>Hold the arrows to steer</span>
            <span>JUMP</span>
            <span>Hop obstacles & gaps</span>
            <span>SLIDE</span>
            <span>Duck under barriers</span>
            <span>TRICK</span>
            <span>Flip in the air for bonus points</span>
          </div>
        ) : (
          <div className="guide-grid">
            <span>
              <Key>A</Key>
              <Key>D</Key> / <Key>←</Key>
              <Key>→</Key>
            </span>
            <span>Steer</span>
            <span>
              <Key>Space</Key> / <Key>↑</Key>
            </span>
            <span>Jump</span>
            <span>
              <Key>S</Key> / <Key>↓</Key>
            </span>
            <span>Slide</span>
            <span>
              <Key>X</Key>
            </span>
            <span>Trick (bonus in the air)</span>
            <span>
              <Key>Esc</Key>
            </span>
            <span>Pause</span>
          </div>
        )}
      </div>
    </div>
  );
}

export function PauseScreen() {
  const phase = useGame((s) => s.phase);
  const muted = useGame((s) => s.muted);
  const score = useGame((s) => s.score);
  if (phase !== 'paused') return null;
  return (
    <div className="screen modal-screen">
      <div className="panel card">
        <h2 className="card-title">PAUSED</h2>
        <p className="card-sub">Score {fmt(score)}</p>
        <div className="card-buttons">
          <button className="btn btn-gold" onClick={() => resumeGame()}>
            RESUME
          </button>
          <button className="btn btn-dark" onClick={() => restartGame()}>
            RESTART
          </button>
          <button className="btn btn-dark" onClick={() => goToMenu()}>
            MAIN MENU
          </button>
        </div>
        <button className="chip-btn card-mute" onClick={() => toggleMute()}>
          <span className="chip-icon">
            <SoundIcon muted={muted} />
          </span>
          {muted ? 'Sound off' : 'Sound on'}
        </button>
        <p className="hint">Press Esc to resume</p>
      </div>
    </div>
  );
}

export function GameOverScreen() {
  const phase = useGame((s) => s.phase);
  const run = useGame((s) => s.lastRun);
  if (phase !== 'gameover' || !run) return null;
  return (
    <div className="screen modal-screen gameover-screen">
      <div className="panel card">
        <h2 className="card-title wipeout">WIPEOUT!</h2>
        {run.newBest && <div className="badge">NEW BEST!</div>}
        <div className="final-score">
          <span className="stat-label">SCORE</span>
          <span className="final-value">{fmt(run.score)}</span>
        </div>
        <div className="result-grid">
          <div className="result">
            <span className="stat-label">COINS</span>
            <span className="result-value">
              <CoinIcon size="1em" /> {fmt(run.coins)}
            </span>
          </div>
          <div className="result">
            <span className="stat-label">DISTANCE</span>
            <span className="result-value">{fmt(run.distance)} m</span>
          </div>
          <div className="result">
            <span className="stat-label">BEST</span>
            <span className="result-value">{fmt(run.best)}</span>
          </div>
        </div>
        <div className="card-buttons">
          <button className="btn btn-gold" onClick={() => restartGame()}>
            RETRY
          </button>
          <button className="btn btn-dark" onClick={() => goToMenu()}>
            MAIN MENU
          </button>
        </div>
        <p className="hint">Press Enter to retry</p>
      </div>
    </div>
  );
}
