import { describe, expect, it } from "vitest";
import { pillTop } from "./palette";

describe("pillTop", () => {
  it("puts the pill on the same band as the row's heat cell and block bar", () => {
    // ROW 22, cells span y+2..y+19; an 18 px pill on a row centred at 11 must match.
    expect(pillTop(11, 18)).toBe(2);
  });
});
