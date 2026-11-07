import { useEffect, useRef, useState } from 'react';
import { useGame } from '../game/store';

/**
 * Short fade-in whenever the game is reset to the start line (new run / back to menu),
 * so jumping back to the beginning of the road reads as a clean restart.
 */
export function RunTransition() {
  const runId = useGame((s) => s.runId);
  const first = useRef(true);
  const [key, setKey] = useState<number | null>(null);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setKey(runId);
    const id = window.setTimeout(() => setKey(null), 600);
    return () => window.clearTimeout(id);
  }, [runId]);
  if (key === null) return null;
  return <div key={key} className="run-fade" aria-hidden="true" />;
}
