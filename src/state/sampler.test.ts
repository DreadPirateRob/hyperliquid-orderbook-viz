import { describe, expect, it } from "vitest";
import type { BookSnapshot, LevelEvent } from "../data/engine-api.types";
import type { Level, Trade } from "../data/feed-events.types";
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
  return { snapshot, events: [], trades: [], settle: false };
}
function sampler(reducedMotion = false) {
  return createSampler(createLevelHistory({ reducedMotion: () => reducedMotion }), {
    reducedMotion: () => reducedMotion,
  });
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
    expect(f.rows.map((r) => r.side)).toEqual([
      "ask",
      "ask",
      "ask",
      "ask",
      "ask",
      "spread",
      "spread",
      "bid",
      "bid",
      "bid",
    ]);
    expect(f.rows.map((r) => r.y)).toEqual(f.rows.map((_, i) => i * ROW));
    expect(f.mid).toBe(1015);
    expect(f.midIdx, "first row below the mid").toBe(6);
    expect(f.ribY).toBe(6 * ROW);
  });

  it("accumulates depth from the touch outward and normalises inside the ruler", () => {
    const s = sampler();
    const f = s.sample(
      input(book([lvl(1000, 1), lvl(990, 2), lvl(980, 8)], [lvl(1030, 3), lvl(1040, 4)])),
      geometry,
      0,
      0.016,
    );
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
    for (let i = 0; i < 600; i++)
      f = s.sample(input(book([lvl(1020, 1)], [lvl(1030, 1)])), geometry, 200 + i * 16, 0.016);
    expect(f?.rows[0]?.px).toBe(1080);
    expect(s.moving()).toBe(false);
  });

  it("uses the BBO as the true best when it is finer than the grid", () => {
    const s = sampler();
    const snap: BookSnapshot = {
      ...book([lvl(1000, 1)], [lvl(1010, 1)]),
      bestBid: lvl(1004, 1),
      bestAsk: lvl(1006, 2),
    };
    const f = s.sample(input(snap), geometry, 0, 0.016);
    expect(f?.mid).toBe(1005);
    expect(f?.share).toBeCloseTo(1 / 3);
    expect(f?.micro).toBeCloseTo(1004 + (1 / 3) * 2);
  });
});

function ev(kind: "added" | "grew", px: number, from: number, to: number): LevelEvent {
  return { side: "bid", px: tick(px), kind, from, to, consumed: 0, cancelled: 0, stream: "fast", time: 0 };
}

describe("sampler with motion", () => {
  it("springs a row's shown size and carries pulses; animation state follows the price across a re-centre", () => {
    const s = sampler();
    let snap = book([lvl(1000, 8)], [lvl(1010, 1)]);
    let f = s.sample(
      { snapshot: snap, events: [ev("added", 1000, 0, 8)], trades: [], settle: false },
      geometry,
      0,
      0.016,
    );
    const row0 = f?.rows.find((r) => r.px === 1000);
    expect(row0?.shown).toBeLessThan(1);
    expect(row0?.live).toBe(8);
    expect(row0?.pulses.map((p) => p.kind)).toEqual(["add"]);
    for (let i = 1; i <= 120; i++) f = s.sample(input(snap), geometry, i * 16, 0.016);
    expect(f?.rows.find((r) => r.px === 1000)?.shown).toBe(8);
    // mid jumps 30 ticks: the anchor retargets; the level's state is looked up by price, not by row index
    snap = book([lvl(1030, 8), lvl(1000, 8)], [lvl(1040, 1)]);
    f = s.sample(
      { snapshot: snap, events: [ev("added", 1030, 0, 8)], trades: [], settle: false },
      geometry,
      2000,
      0.016,
    );
    for (let i = 1; i <= 600; i++) f = s.sample(input(snap), geometry, 2000 + i * 16, 0.016);
    const moved = f?.rows.find((r) => r.px === 1000);
    expect(moved?.shown).toBe(8);
    expect(moved?.first).toBe(0);
    expect(f?.rows.find((r) => r.px === 1030)?.first).toBe(2000);
  });

  it("fills come from trades and fade with v4's 500 ms decay", () => {
    const s = sampler();
    const snap = book([lvl(1000, 1)], [lvl(1010, 1)]);
    s.sample(input(snap), geometry, 0, 0.016);
    let f = s.sample(
      { snapshot: snap, events: [], trades: [{ px: tick(1010), sz: 1, side: "B", time: 0 }], settle: false },
      geometry,
      100,
      0.016,
    );
    expect(f?.rows.find((r) => r.px === 1010)?.pulses).toEqual([{ kind: "fill", t0: 100 }]);
    f = s.sample(input(snap), geometry, 100 + 1600, 0.016);
    expect(f?.rows.find((r) => r.px === 1010)?.pulses).toEqual([]);
  });
});

describe("settling and reduced motion", () => {
  it("settle folds the backlog, then lays rows with springs at target and no pulses", () => {
    const s = sampler();
    const snap = book([lvl(1000, 8)], [lvl(1010, 1)]);
    const f = s.sample(
      { snapshot: snap, events: [ev("added", 1000, 0, 8)], trades: [], settle: true },
      geometry,
      0,
      0.016,
    );
    const row = f?.rows.find((r) => r.px === 1000);
    expect(row?.shown).toBe(8);
    expect(row?.pulses).toEqual([]);
    expect(s.moving()).toBe(false);
  });

  it("reduced motion snaps the anchor on re-centre", () => {
    const s = sampler(true);
    s.sample(input(book([lvl(1000, 1)], [lvl(1010, 1)])), geometry, 0, 0.016);
    const f = s.sample(input(book([lvl(1020, 1)], [lvl(1030, 1)])), geometry, 16, 0.016);
    expect(f?.rows[0]?.px).toBe(1080);
  });
});

function tr(px: number, side: "B" | "A"): Trade {
  return { px: tick(px), sz: 1, side, time: 0 };
}

describe("trails and last trade", () => {
  it("samples level and touch trails every 250 ms and keeps 12 s", () => {
    const s = sampler();
    const snap = book([lvl(1000, 4)], [lvl(1010, 6)]);
    let f = s.sample(
      { snapshot: snap, events: [ev("added", 1000, 0, 4)], trades: [], settle: false },
      geometry,
      0,
      0.016,
    );
    expect(f?.rows.find((r) => r.px === 1000)?.trail).toEqual([{ t: 0, sz: 4 }]);
    expect(f?.midTrail).toEqual([{ t: 0, b: 1000, a: 1010, share: 0.4 }]);
    f = s.sample(input(snap), geometry, 200, 0.016);
    expect(f?.midTrail.length, "no new sample before 250 ms").toBe(1);
    for (let t = 251; t <= 13_000; t += 251) f = s.sample(input(snap), geometry, t, 0.016);
    const trail = f?.rows.find((r) => r.px === 1000)?.trail ?? [];
    expect(trail[0]?.t).toBeGreaterThanOrEqual(13_000 - 12_000 - 251);
    expect(trail.length).toBeGreaterThan(40);
    expect(trail.length).toBeLessThanOrEqual(50);
    expect(f?.midTrail.length).toBe(trail.length);
  });

  it("tracks the last print and its direction against the previous print", () => {
    const s = sampler();
    const snap = book([lvl(1000, 4)], [lvl(1010, 6)]);
    let f = s.sample({ snapshot: snap, events: [], trades: [tr(1010, "B")], settle: false }, geometry, 0, 0.016);
    expect(f?.lastTrade).toEqual({ px: 1010, dir: 0 });
    f = s.sample({ snapshot: snap, events: [], trades: [tr(1000, "A")], settle: false }, geometry, 16, 0.016);
    expect(f?.lastTrade).toEqual({ px: 1000, dir: -1 });
    f = s.sample(
      { snapshot: snap, events: [], trades: [tr(1000, "A"), tr(1010, "B")], settle: false },
      geometry,
      32,
      0.016,
    );
    expect(f?.lastTrade).toEqual({ px: 1010, dir: 1 });
    expect(f?.bestBidSz).toBe(4);
    expect(f?.bestAskSz).toBe(6);
  });
});
