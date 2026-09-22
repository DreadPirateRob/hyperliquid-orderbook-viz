import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import * as Tick from "./tick";
import { priceScale, tick } from "./tick.arbitrary";

function scaleOf(kind: Tick.MarketKind, szDecimals: number): Tick.PriceScale {
  const r = Tick.makeScale(kind, szDecimals);
  if (r._tag === "err") throw r.error;
  return r.value;
}

const btc = scaleOf("perp", 5); // rawTick 0.1
const spot = scaleOf("spot", 2); // rawTick 1e-6

function parsed(px: string, scale: Tick.PriceScale): Tick.Tick {
  const r = Tick.parse(px, scale);
  if (r._tag === "err") throw r.error;
  return r.value;
}

describe("Tick.parse", () => {
  it("parses decimal strings to exact raw-tick counts", () => {
    expect(parsed("111234.5", btc)).toBe(1112345);
    expect(parsed("111234", btc)).toBe(1112340);
    expect(parsed("0.1", btc)).toBe(1);
    expect(parsed("0.000001", spot)).toBe(1);
    expect(parsed("12.345678", spot)).toBe(12345678);
  });

  it("does not round-trip through floats", () => {
    // 0.1 + 0.2 style inputs: 8 decimals of a large spot price
    expect(parsed("40000.12345678", scaleOf("spot", 0))).toBe(4000012345678);
  });

  it("accepts trailing zeros beyond the scale", () => {
    expect(parsed("111234.50", btc)).toBe(1112345);
  });

  it("rejects prices finer than the scale", () => {
    const r = Tick.parse("111234.55", btc);
    expect(r._tag === "err" && r.error._tag).toBe("OffGridPrice");
  });

  it("rejects malformed and negative input", () => {
    for (const px of ["", "abc", "-1", "1.", ".5", "1e3", "1 2", "NaN"]) {
      const r = Tick.parse(px, btc);
      expect(r._tag === "err" && r.error._tag, px).toBe("InvalidPrice");
    }
  });
});

describe("Tick.format", () => {
  it("renders with exactly the scale's decimals", () => {
    expect(Tick.format(parsed("111234.5", btc), btc)).toBe("111234.5");
    expect(Tick.format(parsed("5", btc), btc)).toBe("5.0");
    expect(Tick.format(parsed("0.000001", spot), spot)).toBe("0.000001");
    const zero = scaleOf("perp", 6);
    expect(Tick.format(parsed("7", zero), zero)).toBe("7");
    expect(Tick.format(parsed("0", btc), btc)).toBe("0.0");
  });

  it("round-trips parse ∘ format for every tick on every scale", () => {
    fc.assert(
      fc.property(priceScale(), tick(), (scale, t) => {
        expect(parsed(Tick.format(t, scale), scale)).toBe(t);
      }),
    );
  });
});

describe("Tick.makeScale", () => {
  it("derives decimals as D − szDecimals (6 perp, 8 spot)", () => {
    expect(scaleOf("perp", 5).decimals).toBe(1);
    expect(scaleOf("spot", 2).decimals).toBe(6);
    expect(scaleOf("perp", 0).decimals).toBe(6);
  });

  it("rejects szDecimals outside [0, D] or non-integer", () => {
    for (const [kind, sz] of [["perp", 7], ["spot", 9], ["perp", -1], ["perp", 1.5]] as const) {
      const r = Tick.makeScale(kind, sz);
      expect(r._tag === "err" && r.error._tag, `${kind} ${sz}`).toBe("InvalidScale");
    }
  });
});
