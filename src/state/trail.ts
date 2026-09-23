/** Trails keep this much history (v4 `TRAIL_MS`); render and state map time with the same window. */
export const TRAIL_MS = 12_000;
/** Trail sampling period (v4 `TRAIL_DT`). */
export const TRAIL_DT = 250;

/** Saturation ramp: a level reaches full trail saturation this long after it is first seen (v4 `persistence`). */
export const PERSISTENCE_MS = 20_000;
/** Saturation of a level the instant it appears; the rest ramps in over `PERSISTENCE_MS`. */
export const SAT_FLOOR = 0.35;

/**
 * Drop leading samples older than `cutoff` from a time-ordered buffer.
 *
 * @param buffer - Samples, oldest first; mutated in place.
 * @param cutoff - Oldest frame time to keep.
 */
export function pruneBefore(buffer: Array<{ readonly t: number }>, cutoff: number): void {
  let drop = 0;
  while (drop < buffer.length && (buffer[drop]?.t ?? cutoff) < cutoff) drop++;
  if (drop > 0) buffer.splice(0, drop);
}
