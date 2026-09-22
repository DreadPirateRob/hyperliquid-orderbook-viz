import { z } from "zod";
import type { Precision } from "../domain/grouping";
import type { PriceScale } from "../domain/tick";
import * as Tick from "../domain/tick";
import type { Result } from "../shared/result";
import { err, ok } from "../shared/result";
import type { FeedEvent, Level, Side, Subscription, Trade } from "./feed-events.types";

/**
 * Inbound parser for one Hyperliquid socket frame (already JSON-decoded).
 * Shared by the live socket and the fixture reader, so both feeds produce
 * identical `FeedEvent`s. Wire shapes stay inside this module.
 */

const WireLevel = z.object({ px: z.string(), sz: z.string(), n: z.number().int() });
const WireL2Book = z.object({
  coin: z.string(),
  time: z.number(),
  fast: z.boolean().optional(),
  levels: z.tuple([z.array(WireLevel), z.array(WireLevel)]),
});
const WireBbo = z.object({
  coin: z.string(),
  time: z.number(),
  bbo: z.tuple([WireLevel.nullable(), WireLevel.nullable()]),
});
const WireTrade = z.object({
  coin: z.string(),
  side: z.enum(["B", "A"]),
  px: z.string(),
  sz: z.string(),
  time: z.number(),
});
const WireSubscription = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("l2Book"),
    coin: z.string(),
    fast: z.boolean().optional(),
    nSigFigs: z.number().int().nullish(),
    mantissa: z.number().int().nullish(),
  }),
  z.object({ type: z.literal("bbo"), coin: z.string() }),
  z.object({ type: z.literal("trades"), coin: z.string() }),
]);
const WireFrame = z.discriminatedUnion("channel", [
  z.object({ channel: z.literal("l2Book"), data: WireL2Book }),
  z.object({ channel: z.literal("bbo"), data: WireBbo }),
  z.object({ channel: z.literal("trades"), data: z.array(WireTrade) }),
  z.object({
    channel: z.literal("subscriptionResponse"),
    data: z.object({ method: z.enum(["subscribe", "unsubscribe"]), subscription: WireSubscription }),
  }),
  z.object({ channel: z.literal("pong") }),
]);

/** The frame does not match any known channel shape. */
export class MalformedFrame extends Error {
  readonly _tag = "MalformedFrame" as const;

  constructor(readonly issues: string) {
    super(`Malformed frame: ${issues}`);
  }
}

/** A book side arrived out of order (bids must descend, asks ascend). */
export class LevelsUnordered extends Error {
  readonly _tag = "LevelsUnordered" as const;

  constructor(readonly side: Side) {
    super(`${side} levels are not ${side === "bid" ? "descending" : "ascending"}`);
  }
}

/** A trade's size string is not a finite non-negative number. */
export class InvalidSize extends Error {
  readonly _tag = "InvalidSize" as const;

  constructor(readonly sz: string) {
    super(`Invalid size: ${JSON.stringify(sz)}`);
  }
}

/** Everything the parser can reject. */
export type WireError = MalformedFrame | LevelsUnordered | InvalidSize | Tick.InvalidPrice | Tick.OffGridPrice;

/** What the parser needs to know about the current market. */
export type WireContext = {
  readonly coin: string;
  readonly scale: PriceScale;
  /** Receive time to stamp on the event, ms. */
  readonly rx: number;
  /** True while the first `trades` message after a subscribe is expected (it is history, not flow). */
  readonly tradesHistorical: boolean;
};

/** A frame that parsed fine but carries nothing for this widget. */
export type Ignored = { readonly _tag: "ignored" };

/**
 * Parse one decoded socket frame for the current coin.
 *
 * @param raw - The JSON-decoded frame.
 * @param ctx - Coin, scale and receive time.
 * @returns A feed event, `ignored` for other coins and pongs, or a wire error.
 */
export function parseWireMessage(raw: unknown, ctx: WireContext): Result<FeedEvent | Ignored, WireError> {
  const frame = WireFrame.safeParse(raw);
  if (!frame.success) return err(new MalformedFrame(z.prettifyError(frame.error)));
  const f = frame.data;
  switch (f.channel) {
    case "pong":
      return ok(IGNORED);
    case "l2Book": {
      if (f.data.coin !== ctx.coin) return ok(IGNORED);
      const bids = parseSide(f.data.levels[0], "bid", ctx.scale);
      if (bids._tag === "err") return bids;
      const asks = parseSide(f.data.levels[1], "ask", ctx.scale);
      if (asks._tag === "err") return asks;
      return ok({
        _tag: "l2Book",
        stream: f.data.fast === true ? "fast" : "slow",
        bids: bids.value,
        asks: asks.value,
        time: f.data.time,
        rx: ctx.rx,
      });
    }
    case "bbo": {
      if (f.data.coin !== ctx.coin) return ok(IGNORED);
      const bid = f.data.bbo[0] === null ? ok(undefined) : parseLevel(f.data.bbo[0], ctx.scale);
      if (bid._tag === "err") return bid;
      const ask = f.data.bbo[1] === null ? ok(undefined) : parseLevel(f.data.bbo[1], ctx.scale);
      if (ask._tag === "err") return ask;
      return ok({ _tag: "bbo", bid: bid.value, ask: ask.value, time: f.data.time, rx: ctx.rx });
    }
    case "trades": {
      const trades: Trade[] = [];
      for (const t of f.data) {
        if (t.coin !== ctx.coin) continue;
        const px = Tick.parse(t.px, ctx.scale);
        if (px._tag === "err") return px;
        const sz = parseSize(t.sz);
        if (sz._tag === "err") return sz;
        trades.push({ px: px.value, sz: sz.value, side: t.side, time: t.time });
      }
      if (trades.length === 0 && f.data.length > 0) return ok(IGNORED);
      return ok({ _tag: "trades", trades, historical: ctx.tradesHistorical, rx: ctx.rx });
    }
    case "subscriptionResponse": {
      const s = f.data.subscription;
      if (s.coin !== ctx.coin) return ok(IGNORED);
      return ok({ _tag: "ack", method: f.data.method, subscription: toSubscription(s), rx: ctx.rx });
    }
  }
}

const IGNORED: Ignored = { _tag: "ignored" };

function toSubscription(s: z.infer<typeof WireSubscription>): Subscription {
  switch (s.type) {
    case "l2Book": {
      const precision: Precision =
        s.nSigFigs === null || s.nSigFigs === undefined
          ? { _tag: "full" }
          : { _tag: "aggregated", nSigFigs: s.nSigFigs, mantissa: s.mantissa ?? undefined };
      return { _tag: "l2Book", coin: s.coin, stream: s.fast === true ? "fast" : "slow", precision };
    }
    case "bbo":
      return { _tag: "bbo", coin: s.coin };
    case "trades":
      return { _tag: "trades", coin: s.coin };
  }
}

function parseSize(sz: string): Result<number, InvalidSize> {
  const n = Number(sz);
  if (sz.trim() === "" || !Number.isFinite(n) || n < 0) return err(new InvalidSize(sz));
  return ok(n);
}

function parseLevel(l: z.infer<typeof WireLevel>, scale: PriceScale): Result<Level, WireError> {
  const px = Tick.parse(l.px, scale);
  if (px._tag === "err") return px;
  const sz = parseSize(l.sz);
  if (sz._tag === "err") return sz;
  return ok({ px: px.value, sz: sz.value, n: l.n });
}

function parseSide(
  levels: ReadonlyArray<z.infer<typeof WireLevel>>,
  side: Side,
  scale: PriceScale,
): Result<ReadonlyArray<Level>, WireError> {
  const out: Level[] = [];
  let prev: number | undefined;
  for (const l of levels) {
    const level = parseLevel(l, scale);
    if (level._tag === "err") return level;
    if (prev !== undefined && (side === "bid" ? level.value.px >= prev : level.value.px <= prev))
      return err(new LevelsUnordered(side));
    prev = level.value.px;
    out.push(level.value);
  }
  return ok(out);
}
