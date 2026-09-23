import type { BookSnapshot, Metrics } from "../data/engine-api.types";

/**
 * The metrics HUD's text (v4's `$('hud').textContent`). Pure formatting so it
 * can be asserted without a DOM: the widget writes the result by ref at 2 Hz,
 * never through React state (ADR 0008).
 */

/** Everything the HUD reports. */
export type HudInput = {
  readonly coin: string;
  readonly groupLabel: string;
  readonly snapshot: BookSnapshot;
  readonly metrics: Metrics | undefined;
  /** Render telemetry. */
  readonly fps: number;
  readonly frameP50: number;
  readonly frameP95: number;
};

/** A HUD row: a metric group, its current text, and how to read it. */
export type HudRow = {
  /** Stable identity, so the widget can write each row by ref. */
  readonly key: string;
  /** The rendered, monospace-aligned text. */
  readonly text: string;
};

/**
 * What each metric group means and how to read it. Held beside the formatting
 * because a number nobody can interpret is not a measurement; the widget hangs
 * these on the rows as tooltips and the README repeats them for readers who
 * never hover.
 */
export const HUD_TIPS: Readonly<Record<string, string>> = {
  market:
    "Coin, grouping step and socket state. LIVE is a current book; RESYNCING means a grouping change is in flight and the ladder is frozen rather than mixing two grids.",
  book: "Levels held per side, the share of resting size inside the visible window, and the 5-level imbalance. imb5 runs -1 (all size on the ask) to +1 (all on the bid); near 0 is balanced.",
  pressure:
    "Exponentially weighted size-delta field, 3 s half-life: size joining the book adds, size leaving subtracts. Positive means size is arriving faster on the bid, negative on the ask. It is in grouped size units, so read it against this market's typical row size, not as a percentage.",
  cancel:
    "Of the size that left each side, how much was cancelled rather than traded - by event count and by volume. High by count but low by volume is many small pulls; the reverse is a few large ones. A dash means too few decreases in the window to say.",
  churn:
    "Level changes per second and size churned per second, counting every change rather than only decreases. High churn with low cancel% is genuine turnover; high churn with high cancel% is quoting noise.",
  refill:
    "How fast a consumed level comes back: median time to refill, and the share refilled within 5 s. A quick median with a high @5s share is a resilient book; >30s means most levels never came back inside the window.",
  convex:
    "Share of each side's visible depth sitting nearest the touch. Above 0.5 the book is front-loaded and thin behind it; below 0.5 depth is spread out and the touch is cheaper to move.",
  render:
    "Frame rate and per-frame cost over the last 120 frames. A p95 well under 16.7 ms leaves headroom at 60 fps; a p95 near it means frames are at risk of being dropped.",
};

/**
 * Render the HUD as rows.
 *
 * @param input - Market, metrics and render telemetry.
 * @returns One row per metric group, in display order.
 */
export function hudRows(input: HudInput): ReadonlyArray<HudRow> {
  const m = input.metrics;
  const rows: ReadonlyArray<readonly [string, string]> = [
    ["market", `MARKET   ${input.coin}   group ${input.groupLabel}   state ${input.snapshot.connection}`],
    [
      "book",
      `BOOK     bids ${input.snapshot.bids.length}   asks ${input.snapshot.asks.length}   share ${pct(m?.share)}   imb5 ${num(m?.imbalance5, 3)}`,
    ],
    ["pressure", `PRESSURE ${num(m?.pressure, 3)}   (size-delta field, \u03C4 3 s)`],
    [
      "cancel",
      `CANCEL%  by count  bid ${pct(m?.bid.cancelRatioCount)}  ask ${pct(m?.ask.cancelRatioCount)}\n         by vol    bid ${pct(m?.bid.cancelRatioVolume)}  ask ${pct(m?.ask.cancelRatioVolume)}`,
    ],
    [
      "churn",
      `CHURN/s  bid ${num(m?.bid.eventChurn, 1)}  ask ${num(m?.ask.eventChurn, 1)}   vol bid ${num(m?.bid.volumeChurn, 2)}  ask ${num(m?.ask.volumeChurn, 2)}`,
    ],
    [
      "refill",
      `REFILL   median bid ${ms(m?.bid.medianRefillMs)}  ask ${ms(m?.ask.medianRefillMs)}   @5s bid ${pct(m?.bid.refillAt5s)}  ask ${pct(m?.ask.refillAt5s)}`,
    ],
    [
      "convex",
      `CONVEX   bid ${num(m?.bid.convexity, 2)}  ask ${num(m?.ask.convexity, 2)}   (depth share nearest the touch)`,
    ],
    [
      "render",
      `RENDER   ${input.fps.toFixed(1)} fps   frame p50 ${input.frameP50.toFixed(2)} ms   p95 ${input.frameP95.toFixed(2)} ms`,
    ],
  ];
  return rows.map(([key, text]) => ({ key, text }));
}

function num(v: number | undefined, digits: number): string {
  return v === undefined || Number.isNaN(v) ? "–" : v.toFixed(digits);
}

function pct(v: number | undefined): string {
  return v === undefined || Number.isNaN(v) ? "–" : `${Math.round(v * 100)}%`;
}

function ms(v: number | undefined): string {
  if (v === undefined) return "–";
  return v === Number.POSITIVE_INFINITY ? ">30s" : `${(v / 1000).toFixed(1)}s`;
}
