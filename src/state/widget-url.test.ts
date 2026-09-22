import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DEFAULT_URL_STATE, readUrlState, writeUrlState } from "./widget-url";
import type { UrlState } from "./widget-url";

const arbState = (): fc.Arbitrary<UrlState> =>
  fc.record({
    coin: fc.constantFrom("BTC", "ETH", "@107", "HMSTR"),
    view: fc.constantFrom("ladder" as const, "spine" as const),
    trailsOn: fc.boolean(),
    tapeOn: fc.boolean(),
    overlaysOn: fc.boolean(),
    gridTick: fc.option(fc.integer({ min: 1, max: 1_000_000 }), { nil: undefined }),
  });

describe("widget URL", () => {
  it("round-trips every state", () => {
    fc.assert(
      fc.property(arbState(), (state) => {
        const href = writeUrlState("https://demo.example/app", state);
        expect(readUrlState(new URL(href).search)).toEqual(state);
      }),
    );
  });

  it("writes defaults as absent, so a default URL carries no widget params", () => {
    expect(writeUrlState("https://demo.example/app", DEFAULT_URL_STATE)).toBe("https://demo.example/app");
    expect(readUrlState("")).toEqual(DEFAULT_URL_STATE);
  });

  it("preserves foreign params and only rewrites its own", () => {
    const href = writeUrlState("https://demo.example/app?utm=x&view=spine&fixture=btc", {
      ...DEFAULT_URL_STATE,
      view: "ladder",
      tapeOn: false,
    });
    const url = new URL(href);
    expect(url.searchParams.get("utm")).toBe("x");
    expect(url.searchParams.get("fixture")).toBe("btc");
    expect(url.searchParams.has("view")).toBe(false);
    expect(url.searchParams.get("tape")).toBe("0");
  });

  it("ignores an unusable grouping param", () => {
    expect(readUrlState("?g=abc").gridTick).toBeUndefined();
    expect(readUrlState("?g=-5").gridTick).toBeUndefined();
    expect(readUrlState("?g=20").gridTick).toBe(20);
  });
});
