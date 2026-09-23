/**
 * Trails keep this much history; render and state map time with the same
 * window. v4 used 12 s; 30 s covers a sweep and its aftermath in one view,
 * which is the span worth reading. At `TRAIL_DT` that is 120 samples per level
 * and a tile every `w / 120` px, still above the 2 px floor `trailStrip`
 * enforces at the widths the trail column is given.
 */
export const TRAIL_MS = 30_000;
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
