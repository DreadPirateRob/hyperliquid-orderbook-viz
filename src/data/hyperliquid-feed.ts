import type { Precision } from "../domain/grouping";
import * as Grouping from "../domain/grouping";
import type { PriceScale } from "../domain/tick";
import type { DepthStream, FeedEvent, FeedSource } from "./feed-events.types";
import type { Fetch } from "./hyperliquid-info";
import { fetchMarketMeta } from "./hyperliquid-info";
import { parseWireMessage } from "./wire";

/**
 * The live `FeedSource` over `wss://api.hyperliquid.xyz/ws`: resolves the
 * market via REST, subscribes the four streams, pings every 50 s, reconnects
 * with a fixed 1.5 s delay (v4), and gates `l2Book` pushes per stream until
 * the venue acknowledged that subscription (ADR 0007).
 */

const WS_URL = "wss://api.hyperliquid.xyz/ws";
const PING_MS = 50_000;
const RECONNECT_MS = 1500;

/** What the adapter needs from the host. */
export type HyperliquidFeedOptions = {
  readonly coin: string;
  /** Subscribe at this precision; `undefined` = v4's default, the finest derived option. */
  readonly precision: Precision | undefined;
  readonly fetch: Fetch;
  readonly WebSocket: typeof globalThis.WebSocket;
};

/**
 * Build the live feed.
 *
 * @param options - Coin, precision and host capabilities.
 * @returns A feed source; `select` is delivered by the grouping ticket.
 */
export function createHyperliquidFeed(options: HyperliquidFeedOptions): FeedSource {
  return {
    start: (listener) => new Session(options, listener).stop,
    select: () => {},
  };
}

class Session {
  private ws: WebSocket | undefined;
  private ping: ReturnType<typeof setInterval> | undefined;
  private reconnect: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
  private scale: PriceScale | undefined;
  private precision: Precision | undefined;
  private tradesHistorical = true;
  private readonly acked: Record<DepthStream, boolean> = { slow: false, fast: false };

  constructor(
    private readonly options: HyperliquidFeedOptions,
    private readonly listener: (event: FeedEvent) => void,
  ) {
    void this.boot();
  }

  readonly stop = (): void => {
    this.stopped = true;
    clearInterval(this.ping);
    clearTimeout(this.reconnect);
    this.ws?.close();
    this.ws = undefined;
  };

  private async boot(): Promise<void> {
    const meta = await fetchMarketMeta(this.options.coin, this.options.fetch);
    if (this.stopped) return;
    if (meta._tag === "err") {
      this.listener({
        _tag: "connection",
        event: { _tag: "rejected", line: "info", why: meta.error.message },
        rx: Date.now(),
      });
      this.listener({ _tag: "connection", event: { _tag: "closed", reason: meta.error.message }, rx: Date.now() });
      return;
    }
    const mark = meta.value.mark ?? 1;
    this.scale = meta.value.scale;
    this.precision = this.options.precision ??
      Grouping.deriveOptions(mark, meta.value.scale)[0]?.precision ?? { _tag: "full" };
    this.listener({
      _tag: "market",
      market: { coin: this.options.coin, scale: this.scale, precision: this.precision, mark },
      rx: Date.now(),
    });
    this.connect();
  }

  private connect(): void {
    if (this.stopped) return;
    const ws = new this.options.WebSocket(WS_URL);
    this.ws = ws;
    this.listener({ _tag: "connection", event: { _tag: "connecting" }, rx: Date.now() });
    ws.addEventListener("open", () => {
      this.acked.slow = false;
      this.acked.fast = false;
      this.tradesHistorical = true;
      this.listener({ _tag: "connection", event: { _tag: "open" }, rx: Date.now() });
      for (const stream of ["slow", "fast"] as const)
        ws.send(JSON.stringify({ method: "subscribe", subscription: this.bookSubscription(stream) }));
      ws.send(JSON.stringify({ method: "subscribe", subscription: { type: "bbo", coin: this.options.coin } }));
      ws.send(JSON.stringify({ method: "subscribe", subscription: { type: "trades", coin: this.options.coin } }));
      clearInterval(this.ping);
      this.ping = setInterval(() => ws.readyState === ws.OPEN && ws.send('{"method":"ping"}'), PING_MS);
    });
    ws.addEventListener("message", (m) => this.onMessage(m.data));
    ws.addEventListener("close", () => {
      if (this.ws !== ws) return;
      this.listener({ _tag: "connection", event: { _tag: "closed", reason: "socket closed" }, rx: Date.now() });
      clearInterval(this.ping);
      if (!this.stopped) this.reconnect = setTimeout(() => this.connect(), RECONNECT_MS);
    });
  }

  private bookSubscription(stream: DepthStream): Record<string, unknown> {
    const p = this.precision;
    const sub: Record<string, unknown> = { type: "l2Book", coin: this.options.coin };
    if (stream === "fast") sub["fast"] = true;
    if (p !== undefined && p._tag === "aggregated") {
      sub["nSigFigs"] = p.nSigFigs;
      if (p.mantissa !== undefined) sub["mantissa"] = p.mantissa;
    }
    return sub;
  }

  private onMessage(data: unknown): void {
    if (this.scale === undefined || typeof data !== "string") return;
    const rx = Date.now();
    let raw: unknown;
    try {
      raw = JSON.parse(data);
    } catch {
      this.listener({ _tag: "connection", event: { _tag: "rejected", line: data.slice(0, 200), why: "not JSON" }, rx });
      return;
    }
    const r = parseWireMessage(raw, {
      coin: this.options.coin,
      scale: this.scale,
      rx,
      tradesHistorical: this.tradesHistorical,
    });
    if (r._tag === "err") {
      this.listener({
        _tag: "connection",
        event: { _tag: "rejected", line: data.slice(0, 200), why: r.error.message },
        rx,
      });
      return;
    }
    const ev = r.value;
    switch (ev._tag) {
      case "ignored":
        return;
      case "ack":
        if (ev.subscription._tag === "l2Book" && ev.method === "subscribe") this.acked[ev.subscription.stream] = true;
        break;
      case "l2Book":
        if (!this.acked[ev.stream]) return;
        break;
      case "trades":
        this.tradesHistorical = false;
        break;
      default:
        break;
    }
    this.listener(ev);
  }
}
