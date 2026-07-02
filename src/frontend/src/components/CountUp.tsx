import { useEffect, useRef, useState } from 'react';

// Tiny, dependency-free count-up for metric numbers. Animates from the previous
// value to `value` over ~600ms with an ease-out curve using requestAnimationFrame.
// Reduced-motion safe: when the user prefers reduced motion (or the value isn't a
// finite number) it renders the final value immediately with no animation. The
// final frame is set to the EXACT target so an integer target never shows a
// rounded-wrong final.

const DURATION_MS = 600;

// Cheap easeOutCubic — visually matches the design system's --ease-out curve
// (fast start, gentle settle) without pulling in a bezier solver.
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

export function CountUp({ value, className }: { value: number; className?: string }) {
  const reduced = prefersReducedMotion();
  // Reduced motion → start (and stay) at the final value; otherwise animate up.
  const [display, setDisplay] = useState<number>(() => (reduced ? value : 0));
  // The value the last animation settled on — the next change animates from here
  // (so a live update counts from the old number, not back from zero).
  const fromRef = useRef<number>(reduced ? value : 0);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    // Reduced motion or a non-finite target: snap to the final value, no rAF.
    if (reduced || !Number.isFinite(value)) {
      setDisplay(value);
      fromRef.current = value;
      return;
    }

    const from = fromRef.current;
    const to = value;
    if (from === to) {
      setDisplay(to);
      return;
    }

    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION_MS);
      if (t >= 1) {
        // Exact final value — never a rounding artifact.
        setDisplay(to);
        fromRef.current = to;
        rafRef.current = null;
        return;
      }
      setDisplay(Math.round(from + (to - from) * easeOutCubic(t)));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [value, reduced]);

  // Integer targets render as clean integers throughout; the final frame above
  // is already the exact target, so this only rounds interpolated frames.
  const shown = Number.isInteger(value) ? Math.round(display) : display;
  return <span className={className}>{shown}</span>;
}
