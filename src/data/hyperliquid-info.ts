import { z } from "zod";
import type { MarketKind, PriceScale } from "../domain/tick";
import * as Tick from "../domain/tick";
import type { Result } from "../shared/result";
import { err, ok } from "../shared/result";

/**
 * Outbound adapter for `POST https://api.hyperliquid.xyz/info`. Only what
 * the widget needs to subscribe: the coin's price scale and a reference
 * price. Spot rows that reference token indexes missing from `tokens` are
 * skipped (observed on the venue).
 */

const INFO_URL = "https://api.hyperliquid.xyz/info";

const Meta = z.object({
  universe: z.array(z.object({ name: z.string(), szDecimals: z.number().int(), isDelisted: z.boolean().optional() })),
});
const SpotMeta = z.object({
  universe: z.array(z.object({ name: z.string(), tokens: z.tuple([z.number().int(), z.number().int()]) })),
  tokens: z.array(z.object({ name: z.string(), szDecimals: z.number().int() })),
});
const AllMids = z.record(z.string(), z.string());
const AssetCtx = z.object({
  markPx: z.string(),
  prevDayPx: z.string().nullish(),
  dayNtlVlm: z.string().nullish(),
  funding: z.string().nullish(),
});
const MetaAndAssetCtxs = z.tuple([Meta, z.array(AssetCtx)]);
/** Spot contexts carry a mark and a previous day, but never funding. */
const SpotAssetCtx = z.object({
  markPx: z.string().nullish(),
  midPx: z.string().nullish(),
  prevDayPx: z.string().nullish(),
  dayNtlVlm: z.string().nullish(),
});
const SpotMetaAndAssetCtxs = z.tuple([SpotMeta, z.array(SpotAssetCtx)]);

/** The venue answered, but not with the expected shape. */
export class InfoMalformed extends Error {
  readonly _tag = "InfoMalformed" as const;

  constructor(
    readonly request: string,
    readonly issues: string,
  ) {
    super(`info ${request}: ${issues}`);
  }
}

/** The request failed at the transport or HTTP level. */
export class InfoUnavailable extends Error {
  readonly _tag = "InfoUnavailable" as const;

  constructor(
    readonly request: string,
    override readonly cause: unknown,
  ) {
    super(`info ${request} unavailable`);
  }
}

/** The coin is not in the perp or spot universe. */
export class UnknownCoin extends Error {
  readonly _tag = "UnknownCoin" as const;

  constructor(readonly coin: string) {
    super(`Unknown coin ${coin}`);
  }
}

/** Errors a caller must handle. */
export type InfoError = InfoMalformed | InfoUnavailable | UnknownCoin | Tick.InvalidScale;

/** One selectable market. */
export type MarketSummary = {
  /** Subscription id: `"BTC"` or `"@107"`. */
  readonly coin: string;
  /** What the user reads: `"BTC"` or `"HYPE/USDC"`. */
  readonly display: string;
  readonly kind: MarketKind;
  readonly szDecimals: number;
};

/** Top-bar context for one coin. */
export type MarketStats = {
  readonly mark: number;
  /** 24 h change in percent; spot pairs have no previous close. */
  readonly changePct: number | undefined;
  readonly dayVolume: number | undefined;
  readonly funding: number | undefined;
};

/** What the widget needs before subscribing. */
export type MarketMeta = {
  readonly coin: string;
  readonly scale: PriceScale;
  /** Mark (perp) or mid (spot) in quote units; `undefined` when the venue has no price yet. */
  readonly mark: number | undefined;
};

/** `fetch` as a port so tests and the fixture demo can substitute it. */
export type Fetch = typeof globalThis.fetch;

/**
 * Resolve a coin's scale and reference price.
 *
 * @param coin - `"BTC"` for a perp or `"@107"` for a spot pair.
 * @param fetchFn - The fetch implementation to use.
 * @returns The market meta or a tagged info error.
 */
export async function fetchMarketMeta(coin: string, fetchFn: Fetch): Promise<Result<MarketMeta, InfoError>> {
  const spot = coin.startsWith("@");
  const [szDecimals, mids] = await Promise.all([
    spot ? spotSzDecimals(coin, fetchFn) : perpSzDecimals(coin, fetchFn),
    info("allMids", AllMids, fetchFn),
  ]);
  if (szDecimals._tag === "err") return szDecimals;
  if (mids._tag === "err") return mids;
  if (szDecimals.value === undefined) return err(new UnknownCoin(coin));
  const scale = Tick.makeScale(spot ? "spot" : "perp", szDecimals.value);
  if (scale._tag === "err") return scale;
  const mid = mids.value[coin];
  const mark = mid === undefined ? undefined : Number(mid);
  return ok({ coin, scale: scale.value, mark: mark !== undefined && Number.isFinite(mark) ? mark : undefined });
}

async function perpSzDecimals(
  coin: string,
  fetchFn: Fetch,
): Promise<Result<number | undefined, InfoMalformed | InfoUnavailable>> {
  const meta = await info("meta", Meta, fetchFn);
  if (meta._tag === "err") return meta;
  return ok(meta.value.universe.find((u) => u.name === coin)?.szDecimals);
}

async function spotSzDecimals(
  coin: string,
  fetchFn: Fetch,
): Promise<Result<number | undefined, InfoMalformed | InfoUnavailable>> {
  const meta = await info("spotMeta", SpotMeta, fetchFn);
  if (meta._tag === "err") return meta;
  const pair = meta.value.universe.find((p) => p.name === coin);
  return ok(pair === undefined ? undefined : meta.value.tokens[pair.tokens[0]]?.szDecimals);
}

async function info<T>(
  type: string,
  schema: z.ZodType<T>,
  fetchFn: Fetch,
): Promise<Result<T, InfoMalformed | InfoUnavailable>> {
  let body: unknown;
  try {
    const res = await fetchFn(INFO_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type }),
    });
    if (!res.ok) return err(new InfoUnavailable(type, res.status));
    body = await res.json();
  } catch (cause) {
    return err(new InfoUnavailable(type, cause));
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return err(new InfoMalformed(type, z.prettifyError(parsed.error)));
  return ok(parsed.data);
}

/**
 * The tradeable universe: perps that are not delisted, then spot pairs whose
 * tokens both exist in the token table (the venue lists rows referencing
 * token indexes it does not publish).
 *
 * @param fetchFn - The fetch implementation to use.
 * @returns Markets in venue order, or a tagged info error.
 */
export async function fetchUniverse(fetchFn: Fetch): Promise<Result<ReadonlyArray<MarketSummary>, InfoError>> {
  const [perp, spot] = await Promise.all([info("meta", Meta, fetchFn), info("spotMeta", SpotMeta, fetchFn)]);
  if (perp._tag === "err") return perp;
  if (spot._tag === "err") return spot;
  const out: MarketSummary[] = [];
  for (const u of perp.value.universe) {
    if (u.isDelisted === true) continue;
    out.push({ coin: u.name, display: u.name, kind: "perp", szDecimals: u.szDecimals });
  }
  for (const pair of spot.value.universe) {
    const base = spot.value.tokens[pair.tokens[0]];
    const quote = spot.value.tokens[pair.tokens[1]];
    if (base === undefined || quote === undefined) continue;
    out.push({ coin: pair.name, display: `${base.name}/${quote.name}`, kind: "spot", szDecimals: base.szDecimals });
  }
  return ok(out);
}

/**
 * Per-coin context for the top bar, refreshed on a timer by the caller.
 *
 * @param fetchFn - The fetch implementation to use.
 * @returns Stats keyed by coin, or a tagged info error.
 */
export async function fetchStats(fetchFn: Fetch): Promise<Result<Record<string, MarketStats>, InfoError>> {
  const [ctxs, spotCtxs, mids] = await Promise.all([
    info("metaAndAssetCtxs", MetaAndAssetCtxs, fetchFn),
    info("spotMetaAndAssetCtxs", SpotMetaAndAssetCtxs, fetchFn),
    info("allMids", AllMids, fetchFn),
  ]);
  if (ctxs._tag === "err") return ctxs;
  if (mids._tag === "err") return mids;
  const [universe, contexts] = ctxs.value;
  const out: Record<string, MarketStats> = {};
  universe.universe.forEach((u, i) => {
    const c = contexts[i];
    if (c === undefined) return;
    const mark = Number(c.markPx);
    const prev = c.prevDayPx == null ? Number.NaN : Number(c.prevDayPx);
    out[u.name] = {
      mark,
      changePct: Number.isFinite(prev) && prev !== 0 ? (mark / prev - 1) * 100 : undefined,
      dayVolume: c.dayNtlVlm == null ? undefined : Number(c.dayNtlVlm),
      funding: c.funding == null ? undefined : Number(c.funding),
    };
  });
  // Spot has its own contexts: `allMids` alone gives a price and nothing else,
  // which is why spot rows used to show a bare mark with no 24 h change.
  if (spotCtxs._tag === "ok") {
    const [spotMeta, spotContexts] = spotCtxs.value;
    spotMeta.universe.forEach((pair, i) => {
      const c = spotContexts[i];
      if (c === undefined) return;
      const mark = Number(c.midPx ?? c.markPx ?? Number.NaN);
      if (!Number.isFinite(mark)) return;
      const prev = c.prevDayPx == null ? Number.NaN : Number(c.prevDayPx);
      out[pair.name] = {
        mark,
        changePct: Number.isFinite(prev) && prev !== 0 ? (mark / prev - 1) * 100 : undefined,
        dayVolume: c.dayNtlVlm == null ? undefined : Number(c.dayNtlVlm),
        funding: undefined,
      };
    });
  }
  // Anything the spot contexts did not cover still gets a price from the mids.
  for (const [coin, px] of Object.entries(mids.value)) {
    if (!coin.startsWith("@") || out[coin] !== undefined) continue;
    const mark = Number(px);
    if (!Number.isFinite(mark)) continue;
    out[coin] = { mark, changePct: undefined, dayVolume: undefined, funding: undefined };
  }
  return ok(out);
}
