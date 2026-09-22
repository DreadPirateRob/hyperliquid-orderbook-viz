import { describe, expect, it } from "vitest";
import { pulseState } from "./ladder";

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

  it("is zero with no pulses", () => {
    expect(pulseState([], 0)).toEqual({ fill: 0, ghost: 0, add: 0, grew: 0 });
  });
});
