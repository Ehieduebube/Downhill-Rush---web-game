import { create } from 'zustand';
import { loadNumber, loadString, saveString } from './storage';

export type Phase = 'menu' | 'playing' | 'paused' | 'crashed' | 'gameover';
export type Quality = 'high' | 'low';

export interface Popup {
  id: number;
  text: string;
  sub?: string;
  kind: 'trick' | 'info' | 'best' | 'shield' | 'magnet' | 'boost';
}

export interface RunSummary {
  score: number;
  coins: number;
  best: number;
  newBest: boolean;
  distance: number;
}

function detectQuality(): Quality {
  if (typeof window === 'undefined') return 'high';
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const cores = navigator.hardwareConcurrency ?? 8;
  return coarse || cores <= 4 ? 'low' : 'high';
}

/** True while the rider is still loading (a failed load does not block play: board-only fallback). */
export const isRiderPending = (s: { characterReady: boolean; characterError: boolean }) => !s.characterReady && !s.characterError;

export const isTouchDevice = () =>
  typeof window !== 'undefined' &&
  (('ontouchstart' in window && navigator.maxTouchPoints > 0) ||
    (window.matchMedia?.('(pointer: coarse)').matches ?? false));

interface GameStore {
  phase: Phase;
  score: number;
  coins: number;
  best: number;
  bank: number;
  muted: boolean;
  quality: Quality;
  /** Remaining seconds of each power-up (0 = inactive), rounded to 0.1 s. */
  power: PowerState;
  popups: Popup[];
  lastRun: RunSummary | null;
  runId: number;
  characterError: boolean;
  /** The rider model is in the scene; a run only starts once it is (or it failed to load). */
  characterReady: boolean;
  /** Rider model download progress, 0..1. */
  characterProgress: number;
  setPhase: (p: Phase) => void;
  setCharacterError: (v: boolean) => void;
  setCharacterReady: (v: boolean) => void;
  setCharacterProgress: (v: number) => void;
  setHud: (score: number, coins: number) => void;
  setPower: (v: PowerState) => void;
  setBest: (best: number) => void;
  setBank: (bank: number) => void;
  setLastRun: (r: RunSummary) => void;
  setMuted: (m: boolean) => void;
  setQuality: (q: Quality) => void;
  pushPopup: (text: string, kind?: Popup['kind'], sub?: string) => void;
  dropPopup: (id: number) => void;
  nextRun: () => void;
}

export interface PowerState {
  shield: number;
  magnet: number;
  boost: number;
}
export const NO_POWER: PowerState = { shield: 0, magnet: 0, boost: 0 };

let popupId = 1;

export const useGame = create<GameStore>()((set) => ({
  phase: 'menu',
  score: 0,
  coins: 0,
  best: loadNumber('best', 0),
  bank: loadNumber('bank', 0),
  muted: loadString('muted', 'no', ['yes', 'no'] as const) === 'yes',
  quality: loadString<Quality>('quality', detectQuality(), ['high', 'low'] as const),
  power: NO_POWER,
  popups: [],
  lastRun: null,
  runId: 0,
  characterError: false,
  characterReady: false,
  characterProgress: 0,
  setPhase: (phase) => set({ phase }),
  setCharacterError: (characterError) => set({ characterError }),
  setCharacterReady: (characterReady) => set({ characterReady }),
  setCharacterProgress: (characterProgress) => set({ characterProgress }),
  setHud: (score, coins) => set({ score, coins }),
  setPower: (power) => set({ power }),
  setBest: (best) => set({ best }),
  setBank: (bank) => set({ bank }),
  setLastRun: (lastRun) => set({ lastRun }),
  setMuted: (muted) => {
    saveString('muted', muted ? 'yes' : 'no');
    set({ muted });
  },
  setQuality: (quality) => {
    saveString('quality', quality);
    set({ quality });
  },
  pushPopup: (text, kind = 'trick', sub) =>
    set((st) => ({ popups: [...st.popups.slice(-3), { id: popupId++, text, kind, sub }] })),
  dropPopup: (id) => set((st) => ({ popups: st.popups.filter((p) => p.id !== id) })),
  nextRun: () => set((st) => ({ runId: st.runId + 1, score: 0, coins: 0, power: NO_POWER, popups: [] })),
}));
