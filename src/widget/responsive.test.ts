import { describe, expect, it } from "vitest";
import { BREAKPOINTS, affordancesDiffer, affordancesFor } from "./responsive";

describe("affordancesFor", () => {
  it("keeps every column on a wide host", () => {
    expect(affordancesFor(1500)).toEqual({
      tape: true,
      trails: true,
      overlays: true,
      forcedView: undefined,
      sheet: false,
    });
  });

  it("drops the tape first, then trails, then overlays", () => {
    const wide = affordancesFor(BREAKPOINTS.tape - 1);
    expect([wide.tape, wide.trails, wide.overlays]).toEqual([false, true, true]);
    const mid = affordancesFor(BREAKPOINTS.trails - 1);
    expect([mid.tape, mid.trails, mid.overlays]).toEqual([false, false, true]);
    const narrow = affordancesFor(BREAKPOINTS.overlays - 1);
    expect([narrow.tape, narrow.trails, narrow.overlays]).toEqual([false, false, false]);
  });

  it("includes a column exactly at its breakpoint", () => {
    expect(affordancesFor(BREAKPOINTS.tape).tape).toBe(true);
    expect(affordancesFor(BREAKPOINTS.trails).trails).toBe(true);
    expect(affordancesFor(BREAKPOINTS.overlays).overlays).toBe(true);
  });

  it("forces the spine only below the overlays breakpoint", () => {
    expect(affordancesFor(BREAKPOINTS.overlays).forcedView).toBeUndefined();
    expect(affordancesFor(390).forcedView).toBe("spine");
  });

  it("presents popovers as a sheet below the trails breakpoint", () => {
    expect(affordancesFor(BREAKPOINTS.trails).sheet).toBe(false);
    expect(affordancesFor(BREAKPOINTS.trails - 1).sheet).toBe(true);
  });
});

describe("affordancesDiffer", () => {
  it("is false within a band and true across a breakpoint", () => {
    expect(affordancesDiffer(affordancesFor(1500), affordancesFor(1300))).toBe(false);
    expect(affordancesDiffer(affordancesFor(1300), affordancesFor(1000))).toBe(true);
  });
});
