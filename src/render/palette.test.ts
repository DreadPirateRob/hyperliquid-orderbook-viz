import { describe, expect, it } from "vitest";
import { pillTop } from "./palette";

describe("pillTop", () => {
  it("lifts the box so its glyphs sit on the row's text line", () => {
    // 12px mono under textBaseline "middle": ascent 5.73, descent 3.27 → ink centre 1.23 px above y
    const top = pillTop(10.5, 5.734375, 3.265625, 18);
    expect(top + 9).toBeCloseTo(10.5 - 1.234375, 6);
  });

  it("is the plain centring when the glyph box is symmetric", () => {
    expect(pillTop(100, 6, 6, 18)).toBe(91);
  });
});
