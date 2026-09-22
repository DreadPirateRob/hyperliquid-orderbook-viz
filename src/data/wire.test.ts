import { describe, expect, it } from "vitest";
import * as Tick from "../domain/tick";
import { parseWireMessage } from "./wire";

function scaleOf(kind: Tick.MarketKind, sz: number): Tick.PriceScale {
  const r = Tick.makeScale(kind, sz);
  if (r._tag === "err") throw r.error;
  return r.value;
}
const btc = scaleOf("perp", 5);
const ctx = { coin: "BTC", scale: btc, rx: 1000, tradesHistorical: false };

function parsed(raw: unknown) {
  const r = parseWireMessage(raw, ctx);
  if (r._tag === "err") throw r.error;
  return r.value;
}

describe("parseWireMessage", () => {
  it("parses an l2Book push into ticks, tagging the stream by data.fast", () => {
    const ev = parsed({
      channel: "l2Book",
      data: {
        coin: "BTC",
        time: 5,
        levels: [[{ px: "81069.0", sz: "0.5", n: 2 }], [{ px: "81070.0", sz: "1.25", n: 3 }]],
      },
    });
    expect(ev).toEqual({
      _tag: "l2Book",
      stream: "slow",
      time: 5,
      rx: 1000,
      bids: [{ px: 810690, sz: 0.5, n: 2 }],
      asks: [{ px: 810700, sz: 1.25, n: 3 }],
    });
    const fast = parsed({ channel: "l2Book", data: { coin: "BTC", time: 5, fast: true, levels: [[], []] } });
    expect(fast._tag === "l2Book" && fast.stream).toBe("fast");
  });

  it("rejects an l2Book whose sides are not bids-desc / asks-asc", () => {
    const r = parseWireMessage(
      {
        channel: "l2Book",
        data: {
          coin: "BTC",
          time: 5,
          levels: [
            [
              { px: "1.0", sz: "1", n: 1 },
              { px: "2.0", sz: "1", n: 1 },
            ],
            [],
          ],
        },
      },
      ctx,
    );
    expect(r._tag === "err" && r.error._tag).toBe("LevelsUnordered");
  });

  it("ignores messages for another coin and pongs", () => {
    expect(parsed({ channel: "l2Book", data: { coin: "ETH", time: 1, levels: [[], []] } })).toEqual({
      _tag: "ignored",
    });
    expect(parsed({ channel: "pong" })).toEqual({ _tag: "ignored" });
  });

  it("parses bbo with possibly missing sides", () => {
    const ev = parsed({
      channel: "bbo",
      data: { coin: "BTC", time: 7, bbo: [{ px: "81069.0", sz: "0.1", n: 1 }, null] },
    });
    expect(ev).toEqual({ _tag: "bbo", time: 7, rx: 1000, bid: { px: 810690, sz: 0.1, n: 1 }, ask: undefined });
  });

  it("parses trades keeping only what the widget uses", () => {
    const ev = parsed({
      channel: "trades",
      data: [{ coin: "BTC", side: "B", px: "81070.0", sz: "0.01", time: 9, hash: "0x", tid: 1, users: ["a", "b"] }],
    });
    expect(ev).toEqual({
      _tag: "trades",
      rx: 1000,
      historical: false,
      trades: [{ px: 810700, sz: 0.01, side: "B", time: 9 }],
    });
    const hist = parseWireMessage({ channel: "trades", data: [] }, { ...ctx, tradesHistorical: true });
    expect(hist._tag === "ok" && hist.value._tag === "trades" && hist.value.historical).toBe(true);
  });

  it("parses subscription responses into acks with method and precision", () => {
    const ev = parsed({
      channel: "subscriptionResponse",
      data: {
        method: "subscribe",
        subscription: { type: "l2Book", coin: "BTC", nSigFigs: 5, mantissa: null, fast: true },
      },
    });
    expect(ev).toEqual({
      _tag: "ack",
      rx: 1000,
      method: "subscribe",
      subscription: {
        _tag: "l2Book",
        coin: "BTC",
        stream: "fast",
        precision: { _tag: "aggregated", nSigFigs: 5, mantissa: undefined },
      },
    });
    const bbo = parsed({
      channel: "subscriptionResponse",
      data: { method: "unsubscribe", subscription: { type: "bbo", coin: "BTC" } },
    });
    expect(bbo).toEqual({ _tag: "ack", rx: 1000, method: "unsubscribe", subscription: { _tag: "bbo", coin: "BTC" } });
  });

  it("reports malformed frames and off-grid prices as tagged errors", () => {
    expect(parseWireMessage({ channel: "l2Book", data: { nope: 1 } }, ctx)._tag).toBe("err");
    const r = parseWireMessage(
      { channel: "bbo", data: { coin: "BTC", time: 1, bbo: [{ px: "1.05", sz: "1", n: 1 }, null] } },
      ctx,
    );
    expect(r._tag === "err" && r.error._tag).toBe("OffGridPrice");
  });
});
