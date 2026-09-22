import * as fc from "fast-check";
import * as Tick from "./tick";

/**
 * A price scale for either market kind with a realistic `szDecimals`.
 *
 * @returns An arbitrary over parsed price scales.
 */
export function priceScale(): fc.Arbitrary<Tick.PriceScale> {
  return fc.tuple(fc.constantFrom("perp", "spot"), fc.integer({ min: 0, max: 6 })).map(([kind, szDecimals]) => {
    const r = Tick.makeScale(kind, szDecimals);
    if (r._tag === "err") throw r.error;
    return r.value;
  });
}

/**
 * A tick. Ticks are scale-independent non-negative integers; zero is legal
 * and exercises the formatter's padding branch.
 *
 * @returns An arbitrary over safe-integer ticks.
 */
export function tick(): fc.Arbitrary<Tick.Tick> {
  return fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }).map((n) => {
    const r = Tick.fromInteger(n);
    if (r._tag === "err") throw r.error;
    return r.value;
  });
}
