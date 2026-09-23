import { describe, expect, it } from "vitest";
import * as Tick from "../domain/tick";
import { createAttribution } from "./attribution";

function tick(n: number): Tick.Tick {
  const r = Tick.fromInteger(n);
  if (r._tag === "err") throw r.error;
  return r.value;
}

describe("trade attribution", () => {
  it("splits a decrease into consumed and cancelled by the trades at that price in the push window", () => {
    const a = createAttribution();
    a.addTrade({ px: tick(1000), sz: 0.4, side: "A", time: 0 }, 100);
    const split = a.split("bid", tick(1000), 1, 50, 200);
    expect(split.consumed).toBeCloseTo(0.4, 9);
    expect(split.cancelled).toBeCloseTo(0.6, 9);
  });

  it("only counts trades on the side that was hit, inside the window", () => {
    const a = createAttribution();
    a.addTrade({ px: tick(1000), sz: 1, side: "B", time: 0 }, 100); // a buy lifts the ask
    expect(a.split("bid", tick(1000), 1, 50, 200).consumed).toBe(0);
    expect(a.split("ask", tick(1000), 1, 50, 200).consumed).toBe(1);
    expect(a.split("ask", tick(1000), 1, 150, 200).consumed, "before the window").toBe(0);
    expect(a.split("ask", tick(1000), 1, 0, 50).consumed, "after the window").toBe(0);
  });

  it("never attributes more than the level actually lost", () => {
    const a = createAttribution();
    a.addTrade({ px: tick(1000), sz: 5, side: "A", time: 0 }, 100);
    expect(a.split("bid", tick(1000), 2, 0, 200)).toEqual({ consumed: 2, cancelled: 0 });
  });

  it("re-attributes a decrease when the print lands within the 600 ms grace window", () => {
    const a = createAttribution();
    const pending = a.openPending("bid", tick(1000), 1, { consumed: 0, cancelled: 1 }, 0, 100);
    a.addTrade({ px: tick(1000), sz: 0.7, side: "A", time: 0 }, 400);
    const moved = a.reattribute(500);
    expect(moved.length).toBe(1);
    expect(moved[0]?.side).toBe("bid");
    expect(moved[0]?.px).toBe(1000);
    expect(moved[0]?.consumed).toBeCloseTo(0.7, 9);
    expect(moved[0]?.cancelled).toBeCloseTo(0.3, 9);
    expect(pending.consumed).toBeCloseTo(0.7, 9);
    // after the grace window the record closes and cannot move again
    a.addTrade({ px: tick(1000), sz: 0.3, side: "A", time: 0 }, 800);
    expect(a.reattribute(900)).toEqual([]);
  });

  it("forgets trades older than 15 s", () => {
    const a = createAttribution();
    a.addTrade({ px: tick(1000), sz: 1, side: "A", time: 0 }, 100);
    a.prune(15_200);
    expect(a.split("bid", tick(1000), 1, 0, 15_300).consumed).toBe(0);
  });

  it("keeps its answer after pruning drops an expired prefix", () => {
    const a = createAttribution();
    // A big old print that must expire, then a small recent one.
    a.addTrade({ px: tick(1000), sz: 100, side: "A", time: 0 }, 0);
    a.addTrade({ px: tick(1000), sz: 1, side: "A", time: 0 }, 16_000);
    const before = a.split("bid", tick(1000), 200, 15_000, 16_000);
    expect(before).toEqual({ consumed: 1, cancelled: 199 });

    a.prune(16_000);
    // Cleanup must not change what the window says: the expired print is gone,
    // not folded into the survivors' running totals.
    expect(a.split("bid", tick(1000), 200, 15_000, 16_000)).toEqual(before);

    // And the index must still be correct for prints added after compaction.
    a.addTrade({ px: tick(1000), sz: 2, side: "A", time: 0 }, 16_500);
    expect(a.split("bid", tick(1000), 200, 16_000, 17_000)).toEqual({ consumed: 2, cancelled: 198 });
  });
});
