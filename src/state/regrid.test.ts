import { describe, expect, it } from "vitest";
import type { LevelEvent } from "../data/engine-api.types";
import * as Tick from "../domain/tick";
import { createLevelHistory } from "./level-history";
import { TRAIL_DT, TRAIL_MS } from "./trail";

/**
 * Grouping is a display choice, and history outlives it. An instant belongs to
 * exactly one grid — every price's sample at one instant is written under a
 * single timestamp — so old-grid and new-grid samples never overlap in time
 * and can never be double-counted. What survives a change depends only on the
 * direction: coarsening is derivable and exact, refining is not derivable at
 * all and is kept whole as a band.
 */

function tick(n: number): Tick.Tick {
  const r = Tick.fromInteger(n);
  if (r._tag === "err") throw r.error;
  return r.value;
}

function added(px: number, to: number, side: "bid" | "ask" = "bid"): LevelEvent {
  return { kind: "added", side, px: tick(px), from: 0, to, consumed: 0, cancelled: 0, stream: "slow", time: 0 };
}

/** A history holding one sample per listed level, taken at `grid`. */
function seeded(levels: ReadonlyArray<readonly [number, number]>, grid: number, side: "bid" | "ask" = "bid") {
  const h = createLevelHistory({ reducedMotion: () => true });
  h.applyLevelEvents(
    levels.map(([px, sz]) => added(px, sz, side)),
    0,
  );
  h.sampleTrails(0, 10, grid);
  return h;
}

describe("grouping change keeps history", () => {
  it("merges a finer past into coarser buckets exactly", () => {
    // Ten $1 levels under one $10 row. The coarse trail the venue would have
    // recorded is the sum, and summing is safe because every one of these
    // samples shares the instant it was taken at.
    const h = seeded(
      [
        [1000, 1],
        [1003, 2],
        [1009, 4],
        [1010, 8],
      ],
      1,
    );
    h.regrid(1, 10);
    expect(
      h.trailAt(tick(1000)).map((s) => s.sz),
      "three levels under one bucket",
    ).toEqual([7]);
    expect(h.trailAt(tick(1010)).map((s) => s.sz)).toEqual([8]);
    expect(h.trailAt(tick(1000))[0]?.g, "merged samples belong to the new grid").toBe(10);
    expect(h.bandAt(tick(1000)), "nothing is unresolvable when coarsening").toEqual([]);
  });

  it("reproduces what the coarse grouping would have recorded", () => {
    // The merge is not an approximation of the coarse trail: it is that trail.
    const levels: ReadonlyArray<readonly [number, number]> = [
      [1000, 1],
      [1003, 2],
      [1009, 4],
    ];
    const merged = seeded(levels, 1);
    merged.regrid(1, 10);
    const native = seeded([[1000, 7]], 10);
    expect(merged.trailAt(tick(1000)).map((s) => [s.t, s.sz])).toEqual(
      native.trailAt(tick(1000)).map((s) => [s.t, s.sz]),
    );
  });

  it("keeps a coarser past as a band covering every row it spans", () => {
    // $10 → $1. The ten dollar-rows under the bucket were never observed
    // separately, so each of them shows the same band and none of them claims
    // the depth as its own.
    const h = seeded([[1000, 9]], 10);
    h.regrid(10, 1);
    expect(h.trailAt(tick(1000)), "the old samples are no longer this row's own").toEqual([]);
    for (const px of [1000, 1004, 1009]) {
      expect(
        h.bandAt(tick(px)).map((s) => s.sz),
        `row ${px} is inside the bucket`,
      ).toEqual([9]);
    }
    expect(h.bandAt(tick(1010)), "the next bucket up is not covered").toEqual([]);
    expect(h.bandAt(tick(999)), "nor the one below").toEqual([]);
  });

  it("covers an ask band upward from its bucket price", () => {
    // Asks round up, so a bucket priced 1010 covers (1000, 1010].
    const h = seeded([[1010, 5]], 10, "ask");
    h.regrid(10, 1);
    expect(h.bandAt(tick(1010)).map((s) => s.sz)).toEqual([5]);
    expect(h.bandAt(tick(1001)).map((s) => s.sz)).toEqual([5]);
    expect(h.bandAt(tick(1000)), "the bucket below owns its own price").toEqual([]);
  });

  it("keeps a step that is not a whole multiple as a band", () => {
    // $2 → $5 neither divides nor refines. Nothing can be derived, so nothing
    // is invented: the samples are set aside whole.
    const h = seeded([[1000, 3]], 2);
    h.regrid(2, 5);
    expect(h.trailAt(tick(1000))).toEqual([]);
    expect(h.bandAt(tick(1001)).map((s) => s.sz)).toEqual([3]);
  });

  it("never lets a band and a live trail claim the same instant", () => {
    // The guarantee that makes this safe: after a change, the strip is old-grid
    // bands to the left and new-grid tiles to the right, never both at once.
    const h = seeded([[1000, 9]], 10);
    h.regrid(10, 1);
    h.applyLevelEvents([added(1004, 2)], TRAIL_DT);
    h.sampleTrails(TRAIL_DT, 10, 1);
    const band = h.bandAt(tick(1004));
    const trail = h.trailAt(tick(1004));
    expect(band.map((s) => s.t)).toEqual([0]);
    expect(trail.map((s) => s.t)).toEqual([TRAIL_DT]);
    const instants = new Set(band.map((s) => s.t));
    expect(
      trail.filter((s) => instants.has(s.t)),
      "no instant is described twice",
    ).toEqual([]);
  });

  it("ages bands out of the window like any other history", () => {
    const h = seeded([[1000, 9]], 10);
    h.regrid(10, 1);
    expect(h.bandAt(tick(1004)).length).toBe(1);
    h.sampleTrails(TRAIL_MS + 1, 10, 1);
    expect(h.bandAt(tick(1004)), "a band is history, not a permanent fixture").toEqual([]);
  });

  it("forgets bands when the market changes", () => {
    const h = seeded([[1000, 9]], 10);
    h.regrid(10, 1);
    h.clear();
    expect(h.bandAt(tick(1004))).toEqual([]);
  });
});
