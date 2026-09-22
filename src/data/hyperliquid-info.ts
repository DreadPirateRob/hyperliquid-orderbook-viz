import { z } from "zod";
import type { PriceScale } from "../domain/tick";
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

const Meta = z.object({ universe: z.array(z.object({ name: z.string(), szDecimals: z.number().int(), isDelisted: z.boolean().optional() })) });
const SpotMeta = z.object({
  universe: z.array(z.object({ name: z.string(), tokens: z.tuple([z.number().int(), z.number().int()]) })),
  tokens: z.array(z.object({ name: z.string(), szDecimals: z.number().int() })),
});
const AllMids = z.record(z.string(), z.string());

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
  const [szDecimals, mids] = await Promise.all([spot ? spotSzDecimals(coin, fetchFn) : perpSzDecimals(coin, fetchFn), info("allMids", AllMids, fetchFn)]);
  if (szDecimals._tag === "err") return szDecimals;
  if (mids._tag === "err") return mids;
  if (szDecimals.value === undefined) return err(new UnknownCoin(coin));
  const scale = Tick.makeScale(spot ? "spot" : "perp", szDecimals.value);
  if (scale._tag === "err") return scale;
  const mid = mids.value[coin];
  const mark = mid === undefined ? undefined : Number(mid);
  return ok({ coin, scale: scale.value, mark: mark !== undefined && Number.isFinite(mark) ? mark : undefined });
}

async function perpSzDecimals(coin: string, fetchFn: Fetch): Promise<Result<number | undefined, InfoMalformed | InfoUnavailable>> {
  const meta = await info("meta", Meta, fetchFn);
  if (meta._tag === "err") return meta;
  return ok(meta.value.universe.find((u) => u.name === coin)?.szDecimals);
}

async function spotSzDecimals(coin: string, fetchFn: Fetch): Promise<Result<number | undefined, InfoMalformed | InfoUnavailable>> {
  const meta = await info("spotMeta", SpotMeta, fetchFn);
  if (meta._tag === "err") return meta;
  const pair = meta.value.universe.find((p) => p.name === coin);
  return ok(pair === undefined ? undefined : meta.value.tokens[pair.tokens[0]]?.szDecimals);
}

async function info<T>(type: string, schema: z.ZodType<T>, fetchFn: Fetch): Promise<Result<T, InfoMalformed | InfoUnavailable>> {
  let body: unknown;
  try {
    const res = await fetchFn(INFO_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type }) });
    if (!res.ok) return err(new InfoUnavailable(type, res.status));
    body = await res.json();
  } catch (cause) {
    return err(new InfoUnavailable(type, cause));
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return err(new InfoMalformed(type, z.prettifyError(parsed.error)));
  return ok(parsed.data);
}
