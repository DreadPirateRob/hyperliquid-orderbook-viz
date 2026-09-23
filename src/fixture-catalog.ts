import type { ReplayOption } from "./widget/replay.types";

/**
 * The recordings shipped under `public/fixtures`. A drift test keeps this list
 * and that directory in step, because a quick link to a missing file is a
 * broken demo, not a missing feature.
 */
export const FIXTURES: ReadonlyArray<ReplayOption> = [
  { name: "btc-perp-active", label: "busy book, frequent prints" },
  { name: "btc-perp-quiet", label: "thin flow, long gaps" },
  { name: "btc-grid-change", label: "grouping changes mid-run" },
  { name: "btc-precision-swap", label: "venue re-scales the book" },
  { name: "btc-reconnect", label: "socket drops and resubscribes" },
  { name: "eth-perp", label: "second perp, finer ticks" },
  { name: "low-priced-perp", label: "sub-dollar price, wide decimals" },
  { name: "spot-pair", label: "spot market, no funding" },
];
