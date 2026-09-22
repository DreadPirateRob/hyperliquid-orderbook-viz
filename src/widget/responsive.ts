import type { View } from "./runtime";

/**
 * Width policy for the widget's chrome and columns (spec, story 41).
 *
 * The ladder needs about 470 px of gutter before a bar is even drawn, so a
 * narrow host cannot simply squeeze: columns leave in order of how much width
 * they cost against what they add — tape, then trails, then overlays — and
 * below the last breakpoint the spine is the only reading that fits.
 *
 * Pure, so the breakpoints are testable without a DOM.
 */

/** Width at or above which each column may be drawn, in CSS px. */
export const BREAKPOINTS = { tape: 1280, trails: 900, overlays: 600 } as const;

/** What the current width permits. User toggles are capped by this, never widened. */
export type Affordances = {
  /** Tape column may be drawn. */
  readonly tape: boolean;
  /** Trails column may be drawn. */
  readonly trails: boolean;
  /** Metric overlays may be drawn. */
  readonly overlays: boolean;
  /** A view the width forces, or `undefined` when the user's choice stands. */
  readonly forcedView: View | undefined;
  /** Popovers present as a bottom sheet rather than an anchored panel. */
  readonly sheet: boolean;
};

/**
 * The affordances for a host width.
 *
 * @param width - Host width in CSS px.
 * @returns Which columns fit, the view the width forces, and the popover form.
 */
export function affordancesFor(width: number): Affordances {
  return {
    tape: width >= BREAKPOINTS.tape,
    trails: width >= BREAKPOINTS.trails,
    overlays: width >= BREAKPOINTS.overlays,
    forcedView: width < BREAKPOINTS.overlays ? "spine" : undefined,
    sheet: width < BREAKPOINTS.trails,
  };
}

/**
 * Whether two affordance sets differ, so a resize only re-renders on a crossing.
 *
 * @param a - Previous affordances.
 * @param b - Next affordances.
 * @returns True when any field differs.
 */
export function affordancesDiffer(a: Affordances, b: Affordances): boolean {
  return (
    a.tape !== b.tape ||
    a.trails !== b.trails ||
    a.overlays !== b.overlays ||
    a.forcedView !== b.forcedView ||
    a.sheet !== b.sheet
  );
}
