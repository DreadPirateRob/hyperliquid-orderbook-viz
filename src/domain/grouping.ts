import type { PriceScale } from "./tick";

/**
 * Grouping = the ladder's row step, derived from the subscription precision
 * and the price decade exactly as v4 does (ADR 0009): `tick$ = max(rawTick,
 * m·10^(⌊log10 mid⌋ − N + 1))`. Internally the grid is an integer number of
 * raw ticks so row prices stay exact (ADR 0002).
 */

/**
 * Precision the book streams are subscribed with. A mantissa is only
 * meaningful together with sig-fig aggregation, so it cannot appear alone.
 */
export type Precision =
  | { readonly _tag: "full" }
  | { readonly _tag: "aggregated"; readonly nSigFigs: number; readonly mantissa: number | undefined };

/** One selectable grouping. */
export type GroupOption = {
  readonly precision: Precision;
  /** Row step in raw ticks. */
  readonly gridTick: number;
  /** v4's `$1`, `$0.5`, `$0.000001` label. */
  readonly label: string;
};

const CANDIDATES: ReadonlyArray<{ readonly N: number; readonly m: number | undefined }> = [
  { N: 5, m: undefined },
  { N: 5, m: 2 },
  { N: 5, m: 5 },
  { N: 4, m: undefined },
  { N: 3, m: undefined },
];

/**
 * Row step in raw ticks for a precision at a mid price.
 *
 * @param mid - Mid price in quote units.
 * @param precision - Subscription precision.
 * @param scale - Market price scale.
 * @returns Integer raw ticks per row, at least 1.
 */
export function gridTickFor(mid: number, precision: Precision, scale: PriceScale): number {
  if (precision._tag === "full") return 1;
  const exp = Math.floor(Math.log10(mid)) - precision.nSigFigs + 1 + scale.decimals;
  const ticks = (precision.mantissa ?? 1) * 10 ** exp;
  return Math.max(1, Math.round(ticks));
}

/**
 * The grouping options for a mid price, coarse to fine deduped, sorted by
 * step (v4's `deriveGroupOpts`).
 *
 * @param mid - Mid price in quote units.
 * @param scale - Market price scale.
 * @returns Options sorted by ascending step, at least one.
 */
export function deriveOptions(mid: number, scale: PriceScale): ReadonlyArray<GroupOption> {
  const seen = new Map<number, GroupOption>();
  for (const c of CANDIDATES) {
    const precision: Precision = { _tag: "aggregated", nSigFigs: c.N, mantissa: c.m };
    const gridTick = gridTickFor(mid, precision, scale);
    if (!seen.has(gridTick)) seen.set(gridTick, { precision, gridTick, label: labelFor(gridTick, scale) });
  }
  return [...seen.values()].toSorted((a, b) => a.gridTick - b.gridTick);
}

/** v4's `fmtTick`: `$1`, `$0.50`, `$0.000001`. */
function labelFor(gridTick: number, scale: PriceScale): string {
  const dollars = gridTick / 10 ** scale.decimals;
  if (dollars >= 1) return `$${Number.isInteger(dollars) ? String(dollars) : dollars.toFixed(2)}`;
  const decimals = Math.max(1, -Math.floor(Math.log10(dollars) + 1e-9));
  return `$${dollars.toFixed(decimals)}`;
}
