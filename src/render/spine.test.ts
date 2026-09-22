import { describe, expect, it } from "vitest";
import { spineLayout } from "./spine";

describe("spineLayout", () => {
  it("centres the price column and caps bars at 420 px from the centre", () => {
    expect(spineLayout(1500)).toEqual({ width: 1500, cx: 750, gap: 60, barMax: 360 });
  });

  it("shrinks bars with the viewport so they never cross the edge", () => {
    const narrow = spineLayout(390);
    expect(narrow.cx).toBe(195);
    expect(narrow.barMax).toBe(75);
    // bars end 60 px inside each edge, leaving room for the size labels
    expect(narrow.cx + narrow.gap + narrow.barMax).toBe(narrow.width - 60);
  });
});
