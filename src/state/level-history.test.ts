import { describe, expect, it } from "vitest";
import type { LevelEvent } from "../data/engine-api.types";
import * as Tick from "../domain/tick";
import { createLevelHistory } from "./level-history";

function tick(n: number): Tick.Tick {
  const r = Tick.fromInteger(n);
  if (r._tag === "err") throw r.error;
  return r.value;
}
function ev(kind: LevelEvent["kind"], px: number, from: number, to: number): LevelEvent {
  return { side: "bid", px: tick(px), kind, from, to, consumed: 0, cancelled: 0, stream: "fast", time: 0 };
}

describe("level history", () => {
  it("springs the shown size toward the live size with k=180, c=24", () => {
    const h = createLevelHistory({ reducedMotion: false });
    h.applyLevelEvents([ev("added", 1000, 0, 10)], 0);
    const r0 = h.get("bid", tick(1000));
    expect(r0?.shown).toBe(0);
    expect(r0?.pulses.map((p) => p.kind)).toEqual(["add"]);
    let shown = 0;
    for (let i = 1; i <= 30; i++) {
      h.step(i * 16, 0.016);
      shown = h.get("bid", tick(1000))?.shown ?? -1;
    }
    expect(shown).toBeGreaterThan(9);
    expect(shown).toBeLessThan(11);
    for (let i = 31; i <= 120; i++) h.step(i * 16, 0.016);
    expect(h.get("bid", tick(1000))?.shown).toBe(10);
    expect(h.moving()).toBe(false);
  });

  it("records ghost with the lost width, grew flash, and fills from trades", () => {
    const h = createLevelHistory({ reducedMotion: false });
    h.applyLevelEvents([ev("added", 1000, 0, 10)], 0);
    h.applyLevelEvents([ev("shrank", 1000, 10, 4)], 100);
    const r = h.get("bid", tick(1000));
    expect(r?.prev).toBe(10);
    expect(r?.live).toBe(4);
    expect(r?.pulses.map((p) => [p.kind, p.t0])).toEqual([["add", 0], ["ghost", 100]]);
    h.applyLevelEvents([ev("grew", 1000, 4, 12)], 200);
    expect(h.get("bid", tick(1000))?.pulses.at(-1)?.kind).toBe("grew");
    h.applyTrades([{ px: tick(1000), sz: 1, side: "A", time: 0 }], 300);
    expect(h.get("bid", tick(1000))?.pulses.at(-1)?.kind).toBe("fill");
    // a buy lifts the ask side
    h.applyTrades([{ px: tick(2000), sz: 1, side: "B", time: 0 }], 300);
    expect(h.get("ask", tick(2000))?.pulses.map((p) => p.kind)).toEqual(["fill"]);
    expect(h.get("bid", tick(2000))).toBeUndefined();
  });

  it("caps pulses at six, prunes them after 1.5 s, and forgets dead levels after 60 s", () => {
    const h = createLevelHistory({ reducedMotion: false });
    h.applyLevelEvents([ev("added", 1000, 0, 1)], 0);
    for (let i = 0; i < 10; i++) h.applyLevelEvents([ev("grew", 1000, i, i + 1)], 10 + i);
    expect(h.get("bid", tick(1000))?.pulses.length).toBe(6);
    h.step(1600, 0.016);
    expect(h.get("bid", tick(1000))?.pulses.length).toBe(0);
    h.applyLevelEvents([ev("vanished", 1000, 11, 0)], 2000);
    h.step(2000 + 59_000, 0.016);
    expect(h.get("bid", tick(1000))).toBeDefined();
    h.step(2000 + 61_000, 0.016);
    expect(h.get("bid", tick(1000))).toBeUndefined();
  });

  it("keeps firstSeen across size changes and resets it when a level returns from zero", () => {
    const h = createLevelHistory({ reducedMotion: false });
    h.applyLevelEvents([ev("added", 1000, 0, 1)], 0);
    h.applyLevelEvents([ev("grew", 1000, 1, 5)], 5000);
    expect(h.get("bid", tick(1000))?.first).toBe(0);
    h.applyLevelEvents([ev("vanished", 1000, 5, 0)], 6000);
    for (let i = 0; i < 200; i++) h.step(6000 + i * 16, 0.016);
    h.applyLevelEvents([ev("added", 1000, 0, 2)], 10_000);
    expect(h.get("bid", tick(1000))?.first).toBe(10_000);
  });

  it("outOfWindow drops the level silently: size to zero, no pulse", () => {
    const h = createLevelHistory({ reducedMotion: false });
    h.applyLevelEvents([ev("added", 1000, 0, 1)], 0);
    h.applyLevelEvents([ev("outOfWindow", 1000, 1, 0)], 10);
    const r = h.get("bid", tick(1000));
    expect(r?.live).toBe(0);
    expect(r?.pulses.map((p) => p.kind)).toEqual(["add"]);
  });

  it("reduced motion snaps sizes and records no pulses; snap() settles everything", () => {
    const h = createLevelHistory({ reducedMotion: true });
    h.applyLevelEvents([ev("added", 1000, 0, 10)], 0);
    expect(h.get("bid", tick(1000))?.shown).toBe(10);
    expect(h.get("bid", tick(1000))?.pulses).toEqual([]);
    const live = createLevelHistory({ reducedMotion: false });
    live.applyLevelEvents([ev("added", 1000, 0, 10)], 0);
    live.snap();
    expect(live.get("bid", tick(1000))?.shown).toBe(10);
    expect(live.moving()).toBe(false);
  });
});
