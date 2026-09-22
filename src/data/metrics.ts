import type { PriceScale } from "../domain/tick";
import type { ExecutionCost } from "./engine-api.types";
import type { Level } from "./feed-events.types";

/**
 * Pure calculations over a book side (Derived Metrics Definitions). Every
 * function takes levels best-first and quote prices are derived from the
 * scale, so nothing here reads a clock or the engine's state.
 */

/** Convexity looks at the nearest quarter of the visible price span. */
const NEAR_FRACTION = 0.25;
/** Fewer levels than this and the shape says nothing. */
const MIN_LEVELS_FOR_CONVEXITY = 4;

/**
 * Cost of taking `notional` quote units from one side, walking from the touch.
 *
 * @param levels - The side, best first.
 * @param notional - Quote units to spend.
 * @param mid - Reference mid in quote units, for slippage.
 * @param scale - Price scale for converting ticks to quote prices.
 * @returns VWAP, slippage in bps, fill fraction, levels touched, and whether the book ran out.
 */
export function executionCost(
  levels: ReadonlyArray<Level>,
  notional: number,
  mid: number,
  scale: PriceScale,
): ExecutionCost {
  const unit = 10 ** -scale.decimals;
  let remaining = notional;
  let filled = 0;
  let spent = 0;
  let touched = 0;
  for (const level of levels) {
    if (remaining <= 1e-9) break;
    const px = level.px * unit;
    const take = Math.min(remaining / px, level.sz);
    if (take <= 0) continue;
    filled += take;
    spent += take * px;
    remaining -= take * px;
    touched++;
  }
  const vwap = filled > 0 ? spent / filled : Number.NaN;
  const slippageBps = filled > 0 ? (Math.abs(vwap - mid) / mid) * 1e4 : Number.NaN;
  return {
    vwap,
    slippageBps,
    filledFraction: (notional - Math.max(0, remaining)) / notional,
    levels: touched,
    exceedsVisibleDepth: remaining > 1e-9,
  };
}

/**
 * Share of a side's visible depth sitting in the quarter of the price span
 * nearest the touch: high means front-loaded, 0.25 means flat.
 *
 * @param levels - The side, best first.
 * @returns The share, or `undefined` below four levels.
 */
export function convexity(levels: ReadonlyArray<Level>): number | undefined {
  if (levels.length < MIN_LEVELS_FOR_CONVEXITY) return undefined;
  const best = levels[0];
  const worst = levels[levels.length - 1];
  if (best === undefined || worst === undefined) return undefined;
  const span = Math.abs(worst.px - best.px) || 1;
  let near = 0;
  let total = 0;
  for (const level of levels) {
    total += level.sz;
    if (Math.abs(level.px - best.px) <= span * NEAR_FRACTION) near += level.sz;
  }
  return total > 0 ? near / total : undefined;
}

/**
 * Cumulative depth from the touch outward, for the shape sparkline.
 *
 * @param levels - The side, best first.
 * @returns Running totals, one per level.
 */
export function cumulativeCurve(levels: ReadonlyArray<Level>): ReadonlyArray<number> {
  const out: number[] = [];
  let sum = 0;
  for (const level of levels) {
    sum += level.sz;
    out.push(sum);
  }
  return out;
}

/**
 * Exponentially decayed accumulator for the size-delta field (ADR 0005):
 * `F ← F·e^(−Δt/τ) + delta`.
 *
 * @param value - Previous accumulator value.
 * @param since - Milliseconds since it was last updated.
 * @param tau - Decay constant in ms.
 * @param delta - Size change to add; pass 0 to only decay.
 * @returns The new value.
 */
export function decayField(value: number, since: number, tau: number, delta = 0): number {
  return value * Math.exp(-since / tau) + delta;
}
