// Safe localStorage helpers. Every access is wrapped because storage can be unavailable
// (private mode, blocked site data, embedded previews...).

const PREFIX = 'downhill-rush.';

export function loadNumber(key: string, fallback = 0): number {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (raw === null) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

export function saveNumber(key: string, value: number) {
  try {
    window.localStorage.setItem(PREFIX + key, String(Math.floor(value)));
  } catch {
    /* ignore */
  }
}

export function loadString<T extends string>(key: string, fallback: T, allowed?: readonly T[]): T {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (raw === null) return fallback;
    if (allowed && !allowed.includes(raw as T)) return fallback;
    return raw as T;
  } catch {
    return fallback;
  }
}

export function saveString(key: string, value: string) {
  try {
    window.localStorage.setItem(PREFIX + key, value);
  } catch {
    /* ignore */
  }
}
