/**
 * Two-finger pinch as a grouping gesture (spec, story 41).
 *
 * Touch has no `[`/`]`, and a segmented control at 390 px is a row of 24 px
 * targets. Pinching the ladder reads the same way it does on a chart: spread
 * to see finer prices, squeeze to coarsen. A pure tracker so the thresholds
 * are testable without a touchscreen.
 */

/** Which way the grouping should step, in list order (finer = smaller grid tick). */
export type PinchStep = "finer" | "coarser";

/** Distance ratio that commits one step; below it the gesture is still settling. */
const RATIO = 1.3;

/** Live pointer bookkeeping for one canvas. */
export type PinchTracker = {
  /** A pointer went down. */
  readonly down: (id: number, x: number, y: number) => void;
  /** A pointer moved; returns a step when this move crossed the threshold. */
  readonly move: (id: number, x: number, y: number) => PinchStep | undefined;
  /** A pointer went up or was cancelled. */
  readonly up: (id: number) => void;
  /** Two or more pointers are down, so the gesture owns the surface. */
  readonly pinching: () => boolean;
};

/**
 * Create a pinch tracker.
 *
 * @returns A tracker fed raw pointer events.
 */
export function createPinchTracker(): PinchTracker {
  const points = new Map<number, { x: number; y: number }>();
  let base: number | undefined;

  const spread = (): number | undefined => {
    const [a, b] = [...points.values()];
    if (a === undefined || b === undefined) return undefined;
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  return {
    down: (id, x, y) => {
      points.set(id, { x, y });
      base = spread();
    },
    move: (id, x, y) => {
      if (!points.has(id)) return undefined;
      points.set(id, { x, y });
      const d = spread();
      if (d === undefined || base === undefined || d === 0 || base === 0) return undefined;
      if (d / base >= RATIO) {
        base = d;
        return "finer";
      }
      if (base / d >= RATIO) {
        base = d;
        return "coarser";
      }
      return undefined;
    },
    up: (id) => {
      points.delete(id);
      base = spread();
    },
    pinching: () => points.size >= 2,
  };
}
