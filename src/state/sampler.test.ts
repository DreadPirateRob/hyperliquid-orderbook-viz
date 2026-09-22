import { describe, expect, it } from "vitest";
import type { BookSnapshot } from "../data/engine-api.types";
import type { Level } from "../data/feed-events.types";
import * as Tick from "../domain/tick";
import { createLevelHistory } from "./level-history";
import { ROW, createSampler } from "./sampler";
import type { FrameInput } from "./sampler";

function tick(n: number): Tick.Tick {
  const r = Tick.fromInteger(n);
  if (r._tag === "err") throw r.error;
  return r.value;
}
function lvl(px: number, sz: number): Level {
  return { px: tick(px), sz, n: 1 };
}
function book(bids: ReadonlyArray<Level>, asks: ReadonlyArray<Level>, version = 1): BookSnapshot {
  return { version, bids, asks, bestBid: bids[0], bestAsk: asks[0], lastTrade: undefined, connection: "LIVE" };
}
const geometry = { height: ROW * 10, gridTick: 10, ruler: 3 };
function input(snapshot: BookSnapshot): FrameInput {
  return { snapshot, events: [], trades: [] };
}
function sampler() {
  return createSampler(createLevelHistory({ reducedMotion: false }));
}

describe("sampler", () => {
  it("returns nothing until both sides exist", () => {
    const s = sampler();
    expect(s.sample(input(book([lvl(1000, 1)], [])), geometry, 0, 0.016)).toBeUndefined();
  });

  it("lays rows on the grid around the mid, asks above, bids below, spread rows between", () => {
    const s = sampler();
    const f = s.sample(input(book([lvl(1000, 1), lvl(990, 2)], [lvl(1030, 3), lvl(1040, 4)])), geometry, 0, 0.016);
    if (f === undefined) throw new Error("no frame");
    expect(f.rows.length).toBe(10);
    // centre 1015 → grid row round(101.5)·10 = 1020, half = 5 rows above it
    expect(f.rows.map((r) => r.px)).toEqual([1070, 1060, 1050, 1040, 1030, 1020, 1010, 1000, 990, 980]);
    expect(f.rows.map((r) => r.side)).toEqual(["ask", "ask", "ask", "ask", "ask", "spread", "spread", "bid", "bid", "bid"]);
    expect(f.rows.map((r) => r.y)).toEqual(f.rows.map((_, i) => i * ROW));
    expect(f.mid).toBe(1015);
    expect(f.midIdx, "first row below the mid").toBe(6);
    expect(f.ribY).toBe(6 * ROW);
  });

  it("accumulates depth from the touch outward and normalises inside the ruler", () => {
    const s = sampler();
    const f = s.sample(input(book([lvl(1000, 1), lvl(990, 2), lvl(980, 8)], [lvl(1030, 3), lvl(1040, 4)])), geometry, 0, 0.016);
    if (f === undefined) throw new Error("no frame");
    const at = (px: number) => f.rows.find((r) => r.px === px);
    expect(at(1000)?.cum).toBe(1);
    expect(at(990)?.cum).toBe(3);
    expect(at(980)?.cum).toBe(11);
    expect(at(1030)?.cum).toBe(3);
    expect(at(1040)?.cum).toBe(7);
    expect(at(1070)?.cum, "empty rows carry the running total").toBe(7);
    expect(f.rows.map((r) => r.inRuler)).toEqual([false, false, false, true, true, true, true, true, true, false]);
    expect(f.maxSz).toBe(4);
    expect(f.maxCum).toBe(7);
    expect(f.rulerY).toEqual([3 * ROW, 9 * ROW]);
  });

  it("keeps the anchor until the mid drifts past 30 % of the half window, then springs", () => {
    const s = sampler();
    const first = s.sample(input(book([lvl(1000, 1)], [lvl(1010, 1)])), geometry, 0, 0.016);
    expect(first?.rows[0]?.px).toBe(1060);
    // half = 5 rows → band = 10 * 5 * 0.3 = 15 ticks
    const nudged = s.sample(input(book([lvl(1010, 1)], [lvl(1020, 1)])), geometry, 100, 0.016);
    expect(nudged?.rows[0]?.px).toBe(1060);
    let f = s.sample(input(book([lvl(1020, 1)], [lvl(1030, 1)])), geometry, 200, 0.016);
    expect(f?.rows[0]?.px, "the spring has barely moved on the first frame").toBe(1060);
    // k = 40, c = 13 settles in roughly 5 s at 60 fps
    for (let i = 0; i < 600; i++) f = s.sample(input(book([lvl(1020, 1)], [lvl(1030, 1)])), geometry, 200 + i * 16, 0.016);
    expect(f?.rows[0]?.px).toBe(1080);
    expect(s.moving()).toBe(false);
  });

  it("uses the BBO as the true best when it is finer than the grid", () => {
    const s = sampler();
    const snap: BookSnapshot = { ...book([lvl(1000, 1)], [lvl(1010, 1)]), bestBid: lvl(1004, 1), bestAsk: lvl(1006, 2) };
    const f = s.sample(input(snap), geometry, 0, 0.016);
    expect(f?.mid).toBe(1005);
    expect(f?.share).toBeCloseTo(1 / 3);
    expect(f?.micro).toBeCloseTo(1004 + (1 / 3) * 2);
  });
});
