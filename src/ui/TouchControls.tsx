import { PointerEvent, useEffect, useMemo } from 'react';
import { audio } from '../game/audio';
import { Action, input } from '../game/input';
import { isTouchDevice, useGame } from '../game/store';
import { ArrowIcon, JumpIcon, SlideIcon, TrickIcon } from './icons';

function holdHandlers(dir: 'left' | 'right') {
  const down = (e: PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    audio.init();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    input.setTouch(dir, true);
    e.currentTarget.classList.add('active');
  };
  const up = (e: PointerEvent<HTMLButtonElement>) => {
    input.setTouch(dir, false);
    e.currentTarget.classList.remove('active');
  };
  return {
    onPointerDown: down,
    onPointerUp: up,
    onPointerCancel: up,
    onLostPointerCapture: up,
    onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault(),
  };
}

function tapHandlers(action: Action) {
  return {
    onPointerDown: (e: PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      audio.init();
      input.press(action);
      e.currentTarget.classList.add('active');
    },
    onPointerUp: (e: PointerEvent<HTMLButtonElement>) => e.currentTarget.classList.remove('active'),
    onPointerLeave: (e: PointerEvent<HTMLButtonElement>) => e.currentTarget.classList.remove('active'),
    onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault(),
  };
}

/** Large translucent arcade buttons. Arrows are always shown (as in the key art); action buttons on touch screens. */
export function TouchControls() {
  const phase = useGame((s) => s.phase);
  const touch = useMemo(() => isTouchDevice(), []);
  const left = useMemo(() => holdHandlers('left'), []);
  const right = useMemo(() => holdHandlers('right'), []);
  const jump = useMemo(() => tapHandlers('jump'), []);
  const slide = useMemo(() => tapHandlers('slide'), []);
  const trick = useMemo(() => tapHandlers('trick'), []);
  const visible = phase === 'playing' || phase === 'crashed';

  useEffect(() => {
    if (!visible) {
      input.setTouch('left', false);
      input.setTouch('right', false);
    }
  }, [visible]);

  if (!visible) return null;
  return (
    <div className={`controls ${touch ? 'is-touch' : ''}`}>
      <button className="ctl ctl-arrow ctl-left" aria-label="Steer left" tabIndex={-1} {...left}>
        <ArrowIcon dir="left" />
      </button>
      <button className="ctl ctl-arrow ctl-right" aria-label="Steer right" tabIndex={-1} {...right}>
        <ArrowIcon dir="right" />
      </button>
      {touch && (
        <>
          <button className="ctl ctl-action ctl-slide" aria-label="Slide" tabIndex={-1} {...slide}>
            <SlideIcon />
            <span>SLIDE</span>
          </button>
          <button className="ctl ctl-action ctl-jump" aria-label="Jump" tabIndex={-1} {...jump}>
            <JumpIcon />
            <span>JUMP</span>
          </button>
          <button className="ctl ctl-action ctl-trick" aria-label="Trick" tabIndex={-1} {...trick}>
            <TrickIcon />
            <span>TRICK</span>
          </button>
        </>
      )}
    </div>
  );
}
