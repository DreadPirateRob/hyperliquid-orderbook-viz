import { describe, expect, it } from "vitest";
import * as Grouping from "./grouping";
import * as Tick from "./tick";

function scaleOf(kind: Tick.MarketKind, sz: number): Tick.PriceScale {
  const r = Tick.makeScale(kind, sz);
  if (r._tag === "err") throw r.error;
  return r.value;
}

const btc = scaleOf("perp", 5); // rawTick 0.1
const hmstr = scaleOf("perp", 0); // rawTick 0.000001

describe("Grouping.deriveOptions", () => {
  it("gives BTC at ~81k the five v4 steps $1 $2 $5 $10 $100", () => {
    const opts = Grouping.deriveOptions(81000, btc);
    expect(opts.map((o) => o.label)).toEqual(["$1", "$2", "$5", "$10", "$100"]);
    expect(opts.map((o) => o.gridTick)).toEqual([10, 20, 50, 100, 1000]);
    expect(opts.map((o) => o.precision)).toEqual([
      { _tag: "aggregated", nSigFigs: 5, mantissa: undefined },
      { _tag: "aggregated", nSigFigs: 5, mantissa: 2 },
      { _tag: "aggregated", nSigFigs: 5, mantissa: 5 },
      { _tag: "aggregated", nSigFigs: 4, mantissa: undefined },
      { _tag: "aggregated", nSigFigs: 3, mantissa: undefined },
    ]);
  });

  it("clamps to the raw tick and dedupes for a low-priced coin", () => {
    // HMSTR at 0.0025: N=5 → 1e-7 < raw 1e-6 → raw; N=5 m=2 → 2e-7 → raw (dup); m=5 → raw (dup); N=4 → 1e-6 = raw (dup); N=3 → 1e-5
    const opts = Grouping.deriveOptions(0.0025, hmstr);
    expect(opts.map((o) => o.gridTick)).toEqual([1, 10]);
    expect(opts.map((o) => o.label)).toEqual(["$0.000001", "$0.00001"]);
  });

  it("changes with the price decade", () => {
    expect(Grouping.deriveOptions(99999, btc)[0]?.gridTick).toBe(10);
    expect(Grouping.deriveOptions(100001, btc)[0]?.gridTick).toBe(100);
  });
});

describe("Grouping.gridTickFor", () => {
  it("matches the option table for a precision", () => {
    expect(Grouping.gridTickFor(81000, { _tag: "aggregated", nSigFigs: 5, mantissa: 5 }, btc)).toBe(50);
    expect(Grouping.gridTickFor(81000, { _tag: "full" }, btc)).toBe(1);
  });
});

describe("grid change across a decade", () => {
  it("re-derives the option set when the mid crosses 100k, as the synthetic recording does", () => {
    const below = Grouping.deriveOptions(99_989, btc);
    const above = Grouping.deriveOptions(100_010, btc);
    expect(below.map((o) => o.label)).toEqual(["$1", "$2", "$5", "$10", "$100"]);
    expect(above.map((o) => o.label)).toEqual(["$10", "$20", "$50", "$100", "$1000"]);
    // the same subscription precision now means a coarser row step
    const sig5 = { _tag: "aggregated", nSigFigs: 5, mantissa: undefined } as const;
    expect(Grouping.gridTickFor(99_989, sig5, btc)).toBe(10);
    expect(Grouping.gridTickFor(100_010, sig5, btc)).toBe(100);
  });
});
