import { ComponentType, useEffect } from 'react';
import { POWERUP_INFO } from '../game/powerups';
import type { PowerUpKind } from '../game/runtime';
import { pauseGame, toggleMute } from '../game/sim';
import { Popup, useGame } from '../game/store';
import { BoltIcon, CoinIcon, MagnetIcon, PauseIcon, ShieldIcon, SoundIcon } from './icons';

const fmt = (n: number) => Math.floor(n).toLocaleString('en-US');

export function HUD() {
  const phase = useGame((s) => s.phase);
  const score = useGame((s) => s.score);
  const coins = useGame((s) => s.coins);
  const best = useGame((s) => s.best);
  const muted = useGame((s) => s.muted);
  if (phase === 'menu') return null;
  const hidden = phase === 'gameover';

  return (
    <div className={`hud ${hidden ? 'hud-dim' : ''}`}>
      <div className="hud-left">
        <button
          className="hud-btn pause-btn"
          aria-label="Pause"
          onClick={(e) => {
            e.currentTarget.blur();
            pauseGame();
          }}
          disabled={phase !== 'playing'}
        >
          <PauseIcon />
        </button>
        <div className="panel score-panel">
          <span className="score-label">SCORE</span>
          <span className="score-value">{fmt(score)}</span>
        </div>
        <button
          className="hud-btn mute-btn"
          aria-label={muted ? 'Unmute' : 'Mute'}
          onClick={(e) => {
            e.currentTarget.blur();
            toggleMute();
          }}
        >
          <SoundIcon muted={muted} />
        </button>
      </div>
      <div className="hud-right">
        <div className="panel coin-panel">
          <CoinIcon size="1.35em" />
          <span className="coin-value">{fmt(coins)}</span>
        </div>
        <div className="panel best-panel">BEST: {fmt(Math.max(best, score))}</div>
        <PowerIndicators />
      </div>
    </div>
  );
}

const POWER_ICON: Record<PowerUpKind, ComponentType> = { shield: ShieldIcon, magnet: MagnetIcon, boost: BoltIcon };
const POWER_ORDER: PowerUpKind[] = ['shield', 'magnet', 'boost'];

/** Active power-ups: icon, draining bar and a live countdown (blinks in the last 2 s). */
function PowerIndicators() {
  const power = useGame((s) => s.power);
  const active = POWER_ORDER.filter((k) => power[k] > 0);
  if (!active.length) return null;
  return (
    <div className="power-list">
      {active.map((kind) => {
        const info = POWERUP_INFO[kind];
        const t = power[kind];
        const Icon = POWER_ICON[kind];
        return (
          <div
            key={kind}
            className={`panel power-pill ${t <= 2 ? 'power-ending' : ''}`}
            style={{ ['--power' as string]: info.color }}
            aria-label={`${info.label} active, ${t.toFixed(1)} seconds left`}
          >
            <span className="power-icon">
              <Icon />
            </span>
            <span className="power-bar">
              <span className="power-fill" style={{ transform: `scaleX(${Math.min(t / info.duration, 1)})` }} />
            </span>
            <span className="power-time">{t.toFixed(1)}s</span>
          </div>
        );
      })}
    </div>
  );
}

function PopupItem({ popup }: { popup: Popup }) {
  const drop = useGame((s) => s.dropPopup);
  useEffect(() => {
    const id = window.setTimeout(() => drop(popup.id), popup.kind === 'info' ? 1400 : 1250);
    return () => window.clearTimeout(id);
  }, [popup, drop]);
  return (
    <div className={`popup popup-${popup.kind}`}>
      <div className="popup-text">{popup.text}</div>
      {popup.sub && <div className="popup-sub">{popup.sub}</div>}
    </div>
  );
}

export function Popups() {
  const popups = useGame((s) => s.popups);
  const phase = useGame((s) => s.phase);
  if (phase === 'menu' || phase === 'gameover') return null;
  return (
    <div className="popups" aria-live="polite">
      {popups.map((p) => (
        <PopupItem key={p.id} popup={p} />
      ))}
    </div>
  );
}
