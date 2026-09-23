import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import * as Grouping from "../domain/grouping";
import * as Tick from "../domain/tick";
import { createEngine } from "./engine";
import type { Level } from "./feed-events.types";
import { parseFixture } from "./fixture";
import { convexity } from "./metrics";
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
      const m = engine.metrics();
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
    const first = e.metrics();
    expect(e.metrics(), "same version serves the cache").toBe(first);
    e.apply({ _tag: "l2Book", stream: "slow", bids: [lvl("100.0", 2)], asks: [lvl("101.0", 1)], time: 0, rx: 2 });
    expect(e.metrics(), "a new version recomputes").not.toBe(first);
  });
});

describe("metric cache validity", () => {
  it("re-reads decaying inputs as time passes, not only when the book changes", () => {
    const e = createEngine({ gridTick: 10 });
    e.apply({ _tag: "l2Book", stream: "slow", bids: [lvl("100.0", 1)], asks: [lvl("101.0", 1)], time: 0, rx: 1000 });
    e.apply({ _tag: "l2Book", stream: "slow", bids: [lvl("100.0", 5)], asks: [lvl("101.0", 1)], time: 0, rx: 1500 });
    const early = e.metrics().pressure;
    expect(Math.abs(early)).toBeGreaterThan(0);

    // No further pushes: only the clock moves. The size-delta field decays with
    // τ = 3 s, so pressure must decay with it.
    e.apply({ _tag: "tick", rx: 2500 });
    const later = e.metrics().pressure;
    expect(Math.abs(later)).toBeLessThan(Math.abs(early));
  });
});
