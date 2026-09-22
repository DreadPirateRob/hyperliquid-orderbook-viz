import { describe, expect, it } from "vitest";
import { createPinchTracker } from "./pinch";

describe("createPinchTracker", () => {
  it("ignores a one-finger drag", () => {
    const t = createPinchTracker();
    t.down(1, 100, 100);
    expect(t.move(1, 400, 100)).toBeUndefined();
    expect(t.pinching()).toBe(false);
  });

  it("steps finer when the fingers spread past the threshold", () => {
    const t = createPinchTracker();
    t.down(1, 100, 100);
    t.down(2, 200, 100);
    expect(t.pinching()).toBe(true);
    expect(t.move(2, 220, 100)).toBeUndefined();
    expect(t.move(2, 240, 100)).toBe("finer");
  });

  it("steps coarser when the fingers close past the threshold", () => {
    const t = createPinchTracker();
    t.down(1, 100, 100);
    t.down(2, 300, 100);
    expect(t.move(2, 250, 100)).toBeUndefined();
    expect(t.move(2, 220, 100)).toBe("coarser");
  });

  it("re-baselines after a step, so one long spread walks the list", () => {
    const t = createPinchTracker();
    t.down(1, 100, 100);
    t.down(2, 200, 100);
    expect(t.move(2, 240, 100)).toBe("finer");
    expect(t.move(2, 280, 100)).toBeUndefined();
    expect(t.move(2, 340, 100)).toBe("finer");
  });

  it("stops pinching when a finger lifts and does not fire on the survivor", () => {
    const t = createPinchTracker();
    t.down(1, 100, 100);
    t.down(2, 200, 100);
    t.up(2);
    expect(t.pinching()).toBe(false);
    expect(t.move(1, 900, 100)).toBeUndefined();
  });

  it("ignores a pointer it never saw go down", () => {
    const t = createPinchTracker();
    t.down(1, 100, 100);
    expect(t.move(7, 500, 500)).toBeUndefined();
  });
});
