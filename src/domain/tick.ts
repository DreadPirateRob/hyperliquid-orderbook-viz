import type { Result } from "../shared/result";
import { casesHandled, err, ok } from "../shared/result";

/**
 * A price as an integer count of raw ticks (ADR 0002). Exact equality and
 * Map keys; no float arithmetic on prices inside the engine.
 */
export type Tick = number & { readonly __brand: "Tick" };

/** Market kind; fixes the price-decimals constant `D` (6 perp, 8 spot). */
export type MarketKind = "perp" | "spot";

/**
 * The price scale of one market: prices have exactly `decimals` decimal
 * places, i.e. `rawTick = 10^-decimals`.
 */
export type PriceScale = {
  readonly kind: MarketKind;
  readonly szDecimals: number;
  readonly decimals: number;
};

/** The wire string is not a plain non-negative decimal literal. */
export class InvalidPrice extends Error {
  readonly _tag = "InvalidPrice" as const;

  constructor(readonly px: string) {
    super(`Invalid price string: ${JSON.stringify(px)}`);
  }
}

/** The wire string has significant digits finer than the market's raw tick. */
export class OffGridPrice extends Error {
  readonly _tag = "OffGridPrice" as const;

  constructor(
    readonly px: string,
    readonly decimals: number,
  ) {
    super(`Price ${px} is finer than ${decimals} decimals`);
  }
}

/** The integer is negative or outside the safe-integer range. */
export class InvalidTick extends Error {
  readonly _tag = "InvalidTick" as const;

  constructor(readonly value: number) {
    super(`Not a non-negative safe integer: ${value}`);
  }
}

/** `szDecimals` is not an integer in `[0, D]` for the market kind. */
export class InvalidScale extends Error {
  readonly _tag = "InvalidScale" as const;

  constructor(
    readonly kind: MarketKind,
    readonly szDecimals: number,
  ) {
    super(`szDecimals ${szDecimals} is outside [0, ${priceDecimals(kind)}] for ${kind}`);
  }
}

/**
 * Build the price scale of a market from its size decimals.
 *
 * @param kind - Perp or spot.
 * @param szDecimals - The market's `szDecimals` from `meta`/`spotMeta`.
 * @returns The scale used by `parse` and `format`, or `InvalidScale` when
 *   `szDecimals` would give negative price decimals.
 */
export function makeScale(kind: MarketKind, szDecimals: number): Result<PriceScale, InvalidScale> {
  const d = priceDecimals(kind);
  if (!Number.isInteger(szDecimals) || szDecimals < 0 || szDecimals > d) {
    return err(new InvalidScale(kind, szDecimals));
  }
  return ok({ kind, szDecimals, decimals: d - szDecimals });
}

function priceDecimals(kind: MarketKind): number {
  switch (kind) {
    case "perp":
      return 6;
    case "spot":
      return 8;
    default:
      return casesHandled(kind);
  }
}

const DECIMAL = /^(\d+)(?:\.(\d+))?$/;

/**
 * Parse a wire price string into a tick exactly, without a float round-trip.
 *
 * @param px - The decimal string as sent by the feed, e.g. `"111234.5"`.
 * @param scale - The market's price scale.
 * @returns The tick, `InvalidPrice` for malformed input, or `OffGridPrice`
 *   when a non-zero digit sits beyond the scale's decimals.
 */
export function parse(px: string, scale: PriceScale): Result<Tick, InvalidPrice | OffGridPrice> {
  const m = DECIMAL.exec(px);
  if (m === null) return err(new InvalidPrice(px));
  const whole = m[1] ?? "";
  const frac = m[2] ?? "";
  const kept = frac.slice(0, scale.decimals);
  const dropped = frac.slice(scale.decimals);
  if (/[1-9]/.test(dropped)) return err(new OffGridPrice(px, scale.decimals));
  const digits = whole + kept.padEnd(scale.decimals, "0");
  const n = Number.parseInt(digits, 10);
  if (!Number.isSafeInteger(n)) return err(new InvalidPrice(px));
  // SAFETY: `digits` is a non-empty run of decimal digits, so `n` is a
  // non-negative safe integer; the brand marks it as a parsed tick.
  return ok(n as Tick);
}

/**
 * Brand an already-computed non-negative integer as a tick.
 *
 * @param value - The integer.
 * @returns The tick, or `InvalidTick` for negative or unsafe values.
 */
export function fromInteger(value: number): Result<Tick, InvalidTick> {
  if (!Number.isSafeInteger(value) || value < 0) return err(new InvalidTick(value));
  // SAFETY: checked non-negative safe integer above.
  return ok(value as Tick);
}

/**
 * Render a tick as the feed's decimal string with exactly the scale's
 * decimals (`"5.0"` on a one-decimal scale; `"7"` on a zero-decimal scale).
 *
 * @param tick - The tick to render.
 * @param scale - The market's price scale.
 * @returns The decimal string.
 */
export function format(tick: Tick, scale: PriceScale): string {
  if (scale.decimals === 0) return String(tick);
  const digits = String(tick).padStart(scale.decimals + 1, "0");
  const split = digits.length - scale.decimals;
  return `${digits.slice(0, split)}.${digits.slice(split)}`;
}
