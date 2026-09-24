/**
 * Trails keep this much history; render and state map time with the same
 * window. v4 used 12 s; 60 s holds a sweep, its refill and the quoting that
 * follows in one view, which is the span worth reading when the question is
 * "what happened at this price".
 *
 * At `TRAIL_DT` that is 240 samples per level, so a tile is `w / 240` of the
 * trail column: 2.62 px at 1500, 1.71 px at 1280, 0.96 px at the 900 px
 * breakpoint where the column is narrowest. `trailStrip` floors a tile at
 * 1 px, under the pitch at every width, so tiles meet without overdrawing.
 */
export const TRAIL_MS = 60_000;
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
