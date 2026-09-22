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
  readonly notional: number;
  /** Render telemetry. */
  readonly fps: number;
  readonly frameP50: number;
  readonly frameP95: number;
};

/**
 * Render the HUD block.
 *
 * @param input - Market, metrics and render telemetry.
 * @returns Monospace text, one metric group per paragraph.
 */
export function hudText(input: HudInput): string {
  const m = input.metrics;
  const lines = [
    `MARKET   ${input.coin}   group ${input.groupLabel}   state ${input.snapshot.connection}`,
    `BOOK     bids ${input.snapshot.bids.length}   asks ${input.snapshot.asks.length}   share ${pct(m?.share)}   imb5 ${num(m?.imbalance5, 3)}`,
    "",
    `PRESSURE ${num(m?.pressure, 3)}   (size-delta field, τ 3 s)`,
    `CANCEL%  by count  bid ${pct(m?.bid.cancelRatioCount)}  ask ${pct(m?.ask.cancelRatioCount)}`,
    `         by vol    bid ${pct(m?.bid.cancelRatioVolume)}  ask ${pct(m?.ask.cancelRatioVolume)}`,
    `CHURN/s  bid ${num(m?.bid.eventChurn, 1)}  ask ${num(m?.ask.eventChurn, 1)}   vol bid ${num(m?.bid.volumeChurn, 2)}  ask ${num(m?.ask.volumeChurn, 2)}`,
    `REFILL   median bid ${ms(m?.bid.medianRefillMs)}  ask ${ms(m?.ask.medianRefillMs)}   @5s bid ${pct(m?.bid.refillAt5s)}  ask ${pct(m?.ask.refillAt5s)}`,
    `CONVEX   bid ${num(m?.bid.convexity, 2)}  ask ${num(m?.ask.convexity, 2)}   (depth share nearest the touch)`,
    `COST ${notionalLabel(input.notional)}  buy ${bps(m?.costBuy.slippageBps)}${flag(m?.costBuy.exceedsVisibleDepth)}   sell ${bps(m?.costSell.slippageBps)}${flag(m?.costSell.exceedsVisibleDepth)}`,
    "",
    `RENDER   ${input.fps.toFixed(1)} fps   frame p50 ${input.frameP50.toFixed(2)} ms   p95 ${input.frameP95.toFixed(2)} ms`,
  ];
  return lines.join("\n");
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

function bps(v: number | undefined): string {
  return v === undefined || Number.isNaN(v) ? "–" : `${v.toFixed(1)} bps`;
}

/** Marks a cost that the visible book could not fill — the number is a floor, not the real cost. */
function flag(exceeds: boolean | undefined): string {
  return exceeds === true ? "*" : "";
}

function notionalLabel(notional: number): string {
  return notional >= 1e6 ? `$${notional / 1e6}M` : `$${notional / 1000}k`;
}
