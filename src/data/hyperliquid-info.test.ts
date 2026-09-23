import { describe, expect, it } from "vitest";
import { fetchMarketMeta, fetchUniverse, fetchStats } from "./hyperliquid-info";

type Body = { readonly type: string };

/** A fetch stand-in serving canned `info` responses, so no network is touched. */
function fakeFetch(responses: Record<string, unknown>, log: string[] = []): typeof globalThis.fetch {
  return (async (_url: string, init?: { body?: string }) => {
    const body = JSON.parse(init?.body ?? "{}") as Body;
    log.push(body.type);
    const payload = responses[body.type];
    if (payload === undefined) return { ok: false, status: 404, json: async () => ({}) } as Response;
    return { ok: true, status: 200, json: async () => payload } as Response;
  }) as unknown as typeof globalThis.fetch;
}

const meta = {
  universe: [
    { name: "BTC", szDecimals: 5 },
    { name: "ETH", szDecimals: 4 },
    { name: "DEAD", szDecimals: 2, isDelisted: true },
  ],
};

const spotMeta = {
  universe: [
    { name: "@107", tokens: [1, 0] },
    { name: "@999", tokens: [42, 0] },
  ],
  tokens: [
    { name: "USDC", szDecimals: 2 },
    { name: "HYPE", szDecimals: 2 },
  ],
};

const ctxs = [
  meta,
  [
    { markPx: "86000.0", prevDayPx: "80000.0", dayNtlVlm: "4900000000", funding: "0.0000125" },
    { markPx: "3000.0", prevDayPx: "3100.0", dayNtlVlm: "1200000000", funding: "-0.00001" },
    { markPx: "1.0", prevDayPx: "1.0", dayNtlVlm: "0", funding: "0" },
  ],
];

const allMids = { BTC: "86000.5", ETH: "3000.5", "@107": "41.23", "@999": "7.5" };

/**
 * The venue publishes contexts for pairs that are not in `universe`, in a
 * different order and in greater number, so this list is deliberately not
 * parallel to it: `@107` sits at position 1 here and position 0 there.
 */
const spotCtxs = [
  spotMeta,
  [
    { coin: "@105", midPx: "0.0819", prevDayPx: "0.0835", dayNtlVlm: "0.0" },
    { coin: "@107", midPx: "41.5", prevDayPx: "40.0", dayNtlVlm: "250000" },
    { coin: "@404", midPx: "1.0", prevDayPx: "1.0", dayNtlVlm: "7" },
  ],
];

describe("fetchUniverse", () => {
  it("lists tradeable perps and spot pairs with display names and size decimals", async () => {
    const r = await fetchUniverse(fakeFetch({ meta, spotMeta }));
    if (r._tag === "err") throw r.error;
    expect(r.value.map((m) => [m.coin, m.display, m.kind, m.szDecimals])).toEqual([
      ["BTC", "BTC", "perp", 5],
      ["ETH", "ETH", "perp", 4],
      ["@107", "HYPE/USDC", "spot", 2],
    ]);
  });

  it("skips delisted perps and spot rows whose tokens are missing from the table", async () => {
    const r = await fetchUniverse(fakeFetch({ meta, spotMeta }));
    if (r._tag === "err") throw r.error;
    expect(r.value.some((m) => m.coin === "DEAD")).toBe(false);
    expect(
      r.value.some((m) => m.coin === "@999"),
      "token index 42 is absent from tokens",
    ).toBe(false);
  });

  it("reports a transport failure as a tagged error", async () => {
    const r = await fetchUniverse(fakeFetch({}));
    expect(r._tag === "err" && r.error._tag).toBe("InfoUnavailable");
  });
});

describe("fetchStats", () => {
  it("returns mark, 24 h change, volume and funding per coin", async () => {
    const r = await fetchStats(fakeFetch({ metaAndAssetCtxs: ctxs, allMids }));
    if (r._tag === "err") throw r.error;
    const btc = r.value["BTC"];
    expect(btc?.mark).toBeCloseTo(86_000, 6);
    expect(btc?.changePct).toBeCloseTo(7.5, 6);
    expect(btc?.dayVolume).toBeCloseTo(4.9e9, 0);
    expect(btc?.funding).toBeCloseTo(0.0000125, 9);
    expect(r.value["ETH"]?.changePct).toBeCloseTo(-3.225806, 5);
  });

  it("prices spot pairs from their own contexts, with a 24 h change and no funding", async () => {
    const r = await fetchStats(fakeFetch({ metaAndAssetCtxs: ctxs, spotMetaAndAssetCtxs: spotCtxs, allMids }));
    if (r._tag === "err") throw r.error;
    const hype = r.value["@107"];
    // Joined on the context's own coin: position 0 is a different market whose
    // mark is off by three orders of magnitude, which is what a positional
    // join used to show in the bar.
    expect(hype?.mark).toBeCloseTo(41.5, 6);
    expect(hype?.changePct).toBeCloseTo(3.75, 6);
    expect(hype?.dayVolume).toBeCloseTo(250_000, 0);
    expect(hype?.funding).toBeUndefined();
  });

  it("ignores contexts for pairs the universe does not list", async () => {
    const r = await fetchStats(fakeFetch({ metaAndAssetCtxs: ctxs, spotMetaAndAssetCtxs: spotCtxs, allMids }));
    if (r._tag === "err") throw r.error;
    expect(r.value["@105"]).toBeUndefined();
    expect(r.value["@404"]).toBeUndefined();
  });

  it("falls back to the mids for a spot pair the venue publishes no context for", async () => {
    const r = await fetchStats(fakeFetch({ metaAndAssetCtxs: ctxs, spotMetaAndAssetCtxs: spotCtxs, allMids }));
    if (r._tag === "err") throw r.error;
    expect(r.value["@999"]).toEqual({ mark: 7.5, changePct: undefined, dayVolume: undefined, funding: undefined });
  });

  it("still reports perps when the spot contexts are unavailable", async () => {
    const r = await fetchStats(fakeFetch({ metaAndAssetCtxs: ctxs, allMids }));
    if (r._tag === "err") throw r.error;
    expect(r.value["BTC"]?.mark).toBeCloseTo(86_000, 6);
    expect(r.value["@107"]?.mark).toBeCloseTo(41.23, 6);
  });
});

describe("fetchMarketMeta", () => {
  it("resolves a perp's scale and mark", async () => {
    const r = await fetchMarketMeta("BTC", fakeFetch({ meta, spotMeta, allMids }));
    if (r._tag === "err") throw r.error;
    expect(r.value.scale.decimals).toBe(1);
    expect(r.value.mark).toBeCloseTo(86_000.5, 6);
  });

  it("resolves a spot pair through its base token", async () => {
    const r = await fetchMarketMeta("@107", fakeFetch({ meta, spotMeta, allMids }));
    if (r._tag === "err") throw r.error;
    expect(r.value.scale.decimals).toBe(6);
    expect(r.value.mark).toBeCloseTo(41.23, 6);
  });

  it("rejects a coin the venue does not list", async () => {
    const r = await fetchMarketMeta("NOPE", fakeFetch({ meta, spotMeta, allMids }));
    expect(r._tag === "err" && r.error._tag).toBe("UnknownCoin");
  });
});
