// Inline SVG icons used by the interface.

export function CoinIcon({ size = '1em' }: { size?: string | number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className="coin-icon">
      <defs>
        <radialGradient id="coinFace" cx="38%" cy="32%" r="70%">
          <stop offset="0" stopColor="#fff3a6" />
          <stop offset="0.45" stopColor="#ffcc2e" />
          <stop offset="1" stopColor="#f08a00" />
        </radialGradient>
        <linearGradient id="coinRim" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffe066" />
          <stop offset="1" stopColor="#c86a00" />
        </linearGradient>
      </defs>
      <circle cx="32" cy="32" r="30" fill="url(#coinRim)" />
      <circle cx="32" cy="32" r="24" fill="url(#coinFace)" stroke="#e08a00" strokeWidth="2" />
      <path
        d="M32 15 L36.6 26.2 L48.6 27 L39.4 34.8 L42.3 46.6 L32 40.2 L21.7 46.6 L24.6 34.8 L15.4 27 L27.4 26.2 Z"
        fill="#ffb300"
        stroke="#d97800"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <ellipse cx="24" cy="20" rx="8" ry="4" fill="#fffbe0" opacity="0.6" transform="rotate(-30 24 20)" />
    </svg>
  );
}

export function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true">
      <rect x="5" y="4" width="5" height="16" rx="1.4" fill="currentColor" />
      <rect x="14" y="4" width="5" height="16" rx="1.4" fill="currentColor" />
    </svg>
  );
}

export function SoundIcon({ muted }: { muted: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true">
      <path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" />
      {muted ? (
        <path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      ) : (
        <>
          <path d="M16 8.5a5 5 0 0 1 0 7" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
          <path d="M18.5 6a8.5 8.5 0 0 1 0 12" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}

export function ArrowIcon({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true">
      <path
        d={dir === 'left' ? 'M14 50 L50 18 L50 38 L86 38 L86 62 L50 62 L50 82 Z' : 'M86 50 L50 18 L50 38 L14 38 L14 62 L50 62 L50 82 Z'}
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function JumpIcon() {
  return (
    <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true">
      <path d="M12 3l7 8h-4.5v6h-5v-6H5z" fill="currentColor" />
      <rect x="6" y="19" width="12" height="2.2" rx="1.1" fill="currentColor" />
    </svg>
  );
}

export function SlideIcon() {
  return (
    <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true">
      <path d="M12 21l-7-8h4.5V7h5v6H19z" fill="currentColor" />
      <rect x="6" y="2.8" width="12" height="2.2" rx="1.1" fill="currentColor" />
    </svg>
  );
}

export function TrickIcon() {
  return (
    <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true">
      <path
        d="M12 3l2.5 5.6 6.1.6-4.6 4.1 1.3 6-5.3-3.1-5.3 3.1 1.3-6L3.4 9.2l6.1-.6z"
        fill="currentColor"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true">
      <path d="M12 2.5l7.5 3v5.6c0 4.6-3.1 8.7-7.5 10.4-4.4-1.7-7.5-5.8-7.5-10.4V5.5z" fill="currentColor" />
      <path d="M12 6.2l4.4 1.8v3.2c0 2.8-1.8 5.3-4.4 6.4z" fill="#ffffff" opacity="0.35" />
    </svg>
  );
}

export function MagnetIcon() {
  return (
    <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true">
      <path d="M5 4h4.5v8a2.5 2.5 0 0 0 5 0V4H19v8a7 7 0 0 1-14 0z" fill="currentColor" />
      <rect x="5" y="3" width="4.5" height="3.6" rx="0.6" fill="#f2f0f6" />
      <rect x="14.5" y="3" width="4.5" height="3.6" rx="0.6" fill="#f2f0f6" />
    </svg>
  );
}

export function BoltIcon() {
  return (
    <svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true">
      <path d="M13.5 2L4.5 13.5h6l-1.5 8.5 9-11.5h-6z" fill="currentColor" strokeLinejoin="round" />
    </svg>
  );
}
