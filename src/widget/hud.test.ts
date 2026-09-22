import { describe, expect, it } from "vitest";
import type { BookSnapshot, Metrics } from "../data/engine-api.types";
import { hudText } from "./hud";

const snapshot = {
  version: 1,
  bids: [],
  asks: [],
  bestBid: undefined,
  bestAsk: undefined,
  lastTrade: undefined,
  connection: "LIVE",
} as BookSnapshot;

const metrics = {
  version: 1,
  share: 0.62,
  imbalance5: 0.24,
  micro: 100,
  pressure: -75.3042,
  bid: {
    eventChurn: 2,
    volumeChurn: 0.5,
    cancelRatioCount: 0.93,
    cancelRatioVolume: 1,
    medianRefillMs: 2500,
    refillAt5s: 0.8,
    convexity: 0.3,
  },
  ask: {
    eventChurn: 1,
    volumeChurn: 0.25,
    cancelRatioCount: Number.NaN,
    cancelRatioVolume: Number.NaN,
    medianRefillMs: Number.POSITIVE_INFINITY,
    refillAt5s: undefined,
    convexity: undefined,
  },
  costBuy: { vwap: 100, slippageBps: 0.13, filledFraction: 1, levels: 3, exceedsVisibleDepth: false },
  costSell: { vwap: 99, slippageBps: 12.5, filledFraction: 0.4, levels: 9, exceedsVisibleDepth: true },
} satisfies Metrics;

const input = {
  coin: "BTC",
  groupLabel: "$1",
  snapshot,
  metrics,
  notional: 100_000,
  fps: 30.2,
  frameP50: 4.2,
  frameP95: 5.9,
};

describe("hudText", () => {
  it("reports every metric group with its units", () => {
    const text = hudText(input);
    expect(text).toContain("MARKET   BTC   group $1   state LIVE");
    expect(text).toContain("share 62%");
    expect(text).toContain("PRESSURE -75.304");
    expect(text).toContain("by count  bid 93%  ask –");
    expect(text).toContain("median bid 2.5s  ask >30s");
    expect(text).toContain("CONVEX   bid 0.30  ask –");
    expect(text).toContain("COST $100k  buy 0.1 bps   sell 12.5 bps*");
    expect(text).toContain("30.2 fps   frame p50 4.20 ms   p95 5.90 ms");
  });

  it("names the field rather than calling it OFI (ADR 0005)", () => {
    expect(hudText(input)).toContain("size-delta field");
    expect(hudText(input)).not.toContain("OFI");
  });

  it("renders dashes when metrics are off", () => {
    const text = hudText({ ...input, metrics: undefined });
    expect(text).toContain("PRESSURE –");
    expect(text).toContain("share –");
  });
});
