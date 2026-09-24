import { TRAIL_MS } from "../state/trail";
import { describe, expect, it } from "vitest";
import * as Tick from "../domain/tick";
import { pulseState, rowAtY, tagY, trailX, yOf } from "./ladder";

function tick(n: number): Tick.Tick {
  const r = Tick.fromInteger(n);
  if (r._tag === "err") throw r.error;
  return r.value;
}

describe("pulseState", () => {
  it("decays each kind with v4's time constants and keeps the strongest per kind", () => {
    const t = 1000;
    const ps = pulseState(
      [
        { kind: "fill", t0: t - 500 },
        { kind: "ghost", t0: t - 700 },
        { kind: "add", t0: t - 450 },
        { kind: "grew", t0: t - 400 },
        { kind: "grew", t0: t - 100 },
      ],
      t,
    );
    expect(ps.fill).toBeCloseTo(Math.E ** -1, 6);
    expect(ps.ghost).toBeCloseTo(Math.E ** -1, 6);
    expect(ps.add).toBeCloseTo(Math.E ** -1, 6);
    expect(ps.grew).toBeCloseTo(Math.exp(-100 / 400), 6);
  });

  it("draws consumed decreases with the fill effect", () => {
    expect(pulseState([{ kind: "consumed", t0: 0 }], 0).fill).toBe(1);
  });

  it("is zero with no pulses", () => {
    expect(pulseState([], 0)).toEqual({ fill: 0, ghost: 0, add: 0, grew: 0 });
  });
});

describe("trailX", () => {
  it("places the newest sample at the right edge and glides it left by the elapsed fraction", () => {
    const now = 100_000;
    expect(trailX(now, now, 8, 480)).toBe(488);
    expect(trailX(now - TRAIL_MS, now, 8, 480)).toBe(8);
    // 100 ms after a sample the strip has glided 100/TRAIL_MS of the column,
    // without waiting for the next sample.
    expect(trailX(now - 100, now, 8, 480)).toBeCloseTo(488 - (480 * 100) / TRAIL_MS, 6);
    // Older than the window: off the left edge, where the caller clips it.
    expect(trailX(now - TRAIL_MS - 1000, now, 8, 480)).toBeLessThan(8);
  });
});

describe("yOf", () => {
  const rows = [1020, 1010, 1000].map((px, i) => ({
    i,
    y: i * 22,
    px: tick(px),
    side: "bid" as const,
    shown: 0,
    live: 0,
    prev: 0,
    cum: 0,
    inRuler: true,
    field: 0,
    watch: undefined,
    pulses: [],
    first: 0,
    trail: [],
    band: [],
  }));
  it("centres a grid price on its row and interpolates a finer BBO between rows", () => {
    expect(yOf(rows, 1010)).toBe(33);
    expect(yOf(rows, 1005)).toBe(44);
    expect(yOf(rows, 1017.5)).toBe(11 + (2.5 / 10) * 22);
    expect(yOf(rows, 1030)).toBe(11);
    expect(yOf(rows, 990)).toBe(55);
    expect(yOf([], 5)).toBe(-100);
  });
});

describe("tagY", () => {
  const rows = [1020, 1010, 1000].map((px, i) => ({
    i,
    y: i * 22,
    px: tick(px),
    side: "bid" as const,
    shown: 0,
    live: 0,
    prev: 0,
    cum: 0,
    inRuler: true,
    field: 0,
    watch: undefined,
    pulses: [],
    first: 0,
    trail: [],
    band: [],
  }));
  const frame = { rows, ribY: 33 } as unknown as Parameters<typeof tagY>[0];

  it("centres the tag on the print's row", () => {
    expect(tagY(frame, 1010, 10)).toBe(33);
    expect(tagY(frame, 1012, 10), "within half a grid step").toBe(33);
  });

  it("clamps to the nearest row centre when the print is off screen, never to a row edge", () => {
    expect(tagY(frame, 1100, 10)).toBe(11);
    expect(tagY(frame, 900, 10)).toBe(55);
    for (const px of [1100, 900, 1010]) expect((tagY(frame, px, 10) - 11) % 22).toBe(0);
  });
});

describe("rowAtY", () => {
  const rows = [1020, 1010, 1000].map((px, i) => ({
    i,
    y: i * 22,
    px: tick(px),
    side: "bid" as const,
    shown: 0,
    live: 0,
    prev: 0,
    cum: 0,
    inRuler: true,
    field: 0,
    watch: undefined,
    pulses: [],
    first: 0,
    trail: [],
    band: [],
  }));

  it("returns the row whose band contains the pointer, edges included at the top", () => {
    expect(rowAtY(rows, 0)?.i).toBe(0);
    expect(rowAtY(rows, 21.9)?.i).toBe(0);
    expect(rowAtY(rows, 22)?.i).toBe(1);
    expect(rowAtY(rows, 65)?.i).toBe(2);
  });

  it("returns nothing off the ladder", () => {
    expect(rowAtY(rows, -1)).toBeUndefined();
    expect(rowAtY(rows, 66)).toBeUndefined();
    expect(rowAtY([], 10)).toBeUndefined();
  });
});
