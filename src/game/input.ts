// Keyboard + touch input. Continuous steering state plus buffered one-shot actions.

export type Action = 'jump' | 'slide' | 'trick';

const LEFT_KEYS = new Set(['KeyA', 'ArrowLeft']);
const RIGHT_KEYS = new Set(['KeyD', 'ArrowRight']);
const JUMP_KEYS = new Set(['Space', 'ArrowUp', 'KeyW']);
const SLIDE_KEYS = new Set(['KeyS', 'ArrowDown']);
const TRICK_KEYS = new Set(['KeyX']);
const GAME_KEYS = new Set([...LEFT_KEYS, ...RIGHT_KEYS, ...JUMP_KEYS, ...SLIDE_KEYS, ...TRICK_KEYS]);

export interface InputHandlers {
  onPause: () => void;
  onConfirm: () => void;
  onFirstInteraction: () => void;
}

class InputManager {
  private held = new Set<string>();
  private touch = { left: false, right: false };
  private buffered: Record<Action, number> = { jump: -1, slide: -1, trick: -1 };
  private handlers: InputHandlers | null = null;
  private attached = false;

  private onKeyDown = (e: KeyboardEvent) => {
    this.handlers?.onFirstInteraction();
    if (e.code === 'Escape' || e.code === 'KeyP') {
      e.preventDefault();
      if (!e.repeat) this.handlers?.onPause();
      return;
    }
    if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'KeyR') {
      if (!e.repeat) this.handlers?.onConfirm();
      return;
    }
    if (!GAME_KEYS.has(e.code)) return;
    e.preventDefault();
    this.held.add(e.code);
    if (e.repeat) return;
    if (JUMP_KEYS.has(e.code)) this.press('jump');
    else if (SLIDE_KEYS.has(e.code)) this.press('slide');
    else if (TRICK_KEYS.has(e.code)) this.press('trick');
  };

  private onKeyUp = (e: KeyboardEvent) => {
    if (GAME_KEYS.has(e.code)) e.preventDefault();
    this.held.delete(e.code);
  };

  private onBlur = () => this.clear();

  attach(handlers: InputHandlers) {
    this.handlers = handlers;
    if (this.attached) return;
    this.attached = true;
    window.addEventListener('keydown', this.onKeyDown, { passive: false });
    window.addEventListener('keyup', this.onKeyUp, { passive: false });
    window.addEventListener('blur', this.onBlur);
  }

  detach() {
    if (!this.attached) return;
    this.attached = false;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.handlers = null;
  }

  setTouch(dir: 'left' | 'right', down: boolean) {
    this.touch[dir] = down;
  }

  press(action: Action) {
    this.buffered[action] = performance.now();
  }

  /** Consume a buffered action if it was pressed within `maxAgeMs`. */
  take(action: Action, maxAgeMs = 150): boolean {
    const t = this.buffered[action];
    if (t < 0) return false;
    if (performance.now() - t > maxAgeMs) {
      this.buffered[action] = -1;
      return false;
    }
    this.buffered[action] = -1;
    return true;
  }

  /** Peek without consuming. */
  pending(action: Action, maxAgeMs = 150): boolean {
    const t = this.buffered[action];
    return t >= 0 && performance.now() - t <= maxAgeMs;
  }

  get left() {
    if (this.touch.left) return true;
    for (const k of LEFT_KEYS) if (this.held.has(k)) return true;
    return false;
  }

  get right() {
    if (this.touch.right) return true;
    for (const k of RIGHT_KEYS) if (this.held.has(k)) return true;
    return false;
  }

  /** -1 (left) .. 1 (right) */
  get steer() {
    return (this.right ? 1 : 0) - (this.left ? 1 : 0);
  }

  clear() {
    this.held.clear();
    this.touch.left = false;
    this.touch.right = false;
    this.buffered.jump = this.buffered.slide = this.buffered.trick = -1;
  }
}

export const input = new InputManager();
