import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import * as Grouping from "../domain/grouping";
import * as Tick from "../domain/tick";
import { createEngine } from "./engine";
import type { Level } from "./feed-events.types";
import { parseFixture } from "./fixture";
import { convexity, executionCost } from "./metrics";
import { parseWireMessage } from "./wire";

function scaleOf(): Tick.PriceScale {
  const r = Tick.makeScale("perp", 5);
  if (r._tag === "err") throw r.error;
  return r.value;
}
const btc = scaleOf();
function tick(px: string): Tick.Tick {
  const r = Tick.parse(px, btc);
  if (r._tag === "err") throw r.error;
  return r.value;
}
function lvl(px: string, sz: number): Level {
  return { px: tick(px), sz, n: 1 };
}
/** Quote price of a tick on the BTC scale. */
function quote(t: number): number {
  return t * 10 ** -btc.decimals;
}

describe("execution cost", () => {
  it("walks the book from the touch and reports VWAP, slippage and fill fraction", () => {
    // asks: 100 @ 1, 101 @ 2, 102 @ 4 (quote prices); buy 302 of notional
    const asks = [lvl("100.0", 1), lvl("101.0", 2), lvl("102.0", 4)];
    const cost = executionCost(asks, 302, 99.5, btc);
    // 1 @ 100 + 2 @ 101 = 302 notional, 3 coins
    expect(cost.filledFraction).toBeCloseTo(1, 9);
    expect(cost.vwap).toBeCloseTo(302 / 3, 9);
    expect(cost.levels).toBe(2);
    expect(cost.exceedsVisibleDepth).toBe(false);
    expect(cost.slippageBps).toBeCloseTo(((302 / 3 - 99.5) / 99.5) * 1e4, 6);
  });

  it("flags a notional the visible book cannot fill", () => {
    const cost = executionCost([lvl("100.0", 1)], 1000, 100, btc);
    expect(cost.exceedsVisibleDepth).toBe(true);
    expect(cost.filledFraction).toBeCloseTo(0.1, 9);
    expect(cost.levels).toBe(1);
  });

  it("always prices between the touch and the deepest level it consumed", () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.integer({ min: 1000, max: 2000 }), fc.double({ min: 0.001, max: 5, noNaN: true })), {
          minLength: 1,
          maxLength: 12,
        }),
        fc.double({ min: 100, max: 1e6, noNaN: true }),
        (raw, notional) => {
          const levels = raw
            .map(([px, sz]) => ({ px: tick(`${px}.0`), sz, n: 1 }))
            .toSorted((a, b) => a.px - b.px)
            .filter((l, i, all) => i === 0 || l.px !== all[i - 1]?.px);
          const best = levels[0];
          if (best === undefined) return;
          const cost = executionCost(levels, notional, quote(best.px), btc);
          if (cost.filledFraction === 0) return;
          const deepest = levels[cost.levels - 1];
          expect(cost.vwap).toBeGreaterThanOrEqual(quote(best.px) - 1e-9);
          expect(cost.vwap).toBeLessThanOrEqual(quote(deepest?.px ?? best.px) + 1e-9);
          expect(cost.slippageBps).toBeGreaterThanOrEqual(0);
        },
      ),
    );
  });
});

describe("convexity", () => {
  it("is higher for a front-loaded book than a flat one", () => {
    const front = [lvl("100.0", 10), lvl("101.0", 1), lvl("102.0", 1), lvl("103.0", 1)];
    const flat = [lvl("100.0", 3), lvl("101.0", 3), lvl("102.0", 3), lvl("103.0", 3)];
    expect(convexity(front) ?? 0).toBeGreaterThan(convexity(flat) ?? 1);
    expect(convexity(flat) ?? Number.NaN).toBeCloseTo(0.25, 6);
  });

  it("is undefined below four levels", () => {
    expect(convexity([lvl("100.0", 1), lvl("101.0", 1)])).toBeUndefined();
  });
});

describe("engine metrics on a recording", () => {
  it("reports a cancel ratio, pressure and costs that stay in range while replaying BTC", () => {
    const parsed = parseFixture(gunzipSync(readFileSync("fixtures/btc-perp-active.jsonl.gz")).toString("utf8"));
    if (parsed._tag === "err") throw parsed.error;
    const fx = parsed.value;
    const engine = createEngine({ gridTick: Grouping.gridTickFor(81_000, fx.meta.precision, fx.meta.scale) });
    let historical = true;
    let lastVersion = -1;
    let metricsCalls = 0;
    for (const line of fx.lines) {
      if (line._tag !== "frame") continue;
      const r = parseWireMessage(line.frame, {
        coin: fx.meta.coin,
        scale: fx.meta.scale,
        rx: line.rx,
        tradesHistorical: historical,
      });
      if (r._tag === "err") throw r.error;
      if (r.value._tag === "ignored") continue;
      if (r.value._tag === "trades") historical = false;
      engine.apply(r.value);
      const version = engine.snapshot().version;
      if (version === lastVersion) continue;
      lastVersion = version;
      metricsCalls++;
      const m = engine.metrics(100_000);
      expect(m.version).toBe(version);
      for (const side of [m.bid, m.ask]) {
        if (!Number.isNaN(side.cancelRatioCount)) {
          expect(side.cancelRatioCount).toBeGreaterThanOrEqual(0);
          expect(side.cancelRatioCount).toBeLessThanOrEqual(1);
        }
        if (!Number.isNaN(side.cancelRatioVolume)) {
          expect(side.cancelRatioVolume).toBeGreaterThanOrEqual(0);
          expect(side.cancelRatioVolume).toBeLessThanOrEqual(1);
        }
        expect(side.eventChurn).toBeGreaterThanOrEqual(0);
      }
      expect(m.share).toBeGreaterThanOrEqual(0);
      expect(m.share).toBeLessThanOrEqual(1);
      expect(Number.isFinite(m.pressure)).toBe(true);
    }
    expect(metricsCalls).toBeGreaterThan(100);
  });

  it("computes once per version and serves the cache afterwards", () => {
    const e = createEngine({ gridTick: 10 });
    e.apply({ _tag: "l2Book", stream: "slow", bids: [lvl("100.0", 1)], asks: [lvl("101.0", 1)], time: 0, rx: 1 });
    const first = e.metrics(10_000);
    expect(e.metrics(10_000)).toBe(first);
    expect(e.metrics(100_000), "a different notional recomputes").not.toBe(first);
    e.apply({ _tag: "l2Book", stream: "slow", bids: [lvl("100.0", 2)], asks: [lvl("101.0", 1)], time: 0, rx: 2 });
    expect(e.metrics(10_000)).not.toBe(first);
  });
});

describe("engine execution cost", () => {
  it("prices a notional once the engine knows the market's scale", () => {
    const e = createEngine({ gridTick: 10, scale: btc });
    e.apply({
      _tag: "l2Book",
      stream: "slow",
      bids: [lvl("99.0", 10), lvl("98.0", 10)],
      asks: [lvl("100.0", 1), lvl("101.0", 10)],
      time: 0,
      rx: 1,
    });
    const m = e.metrics(1000);
    expect(m.costBuy.exceedsVisibleDepth).toBe(false);
    expect(m.costBuy.vwap).toBeGreaterThan(100);
    expect(m.costBuy.vwap).toBeLessThan(101);
    expect(m.costBuy.slippageBps).toBeGreaterThan(0);
    expect(m.costSell.filledFraction).toBeCloseTo(1, 9);
  });

  it("reports an unusable cost when the engine has no scale yet", () => {
    const e = createEngine({ gridTick: 10 });
    e.apply({ _tag: "l2Book", stream: "slow", bids: [lvl("99.0", 10)], asks: [lvl("100.0", 10)], time: 0, rx: 1 });
    expect(e.metrics(1000).costBuy.exceedsVisibleDepth).toBe(true);
  });
});
