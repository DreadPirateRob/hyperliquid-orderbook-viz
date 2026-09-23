import type { Precision } from "../domain/grouping";
import * as Grouping from "../domain/grouping";
import type { PriceScale } from "../domain/tick";
import type { DepthStream, FeedEvent, FeedSource } from "./feed-events.types";
import type { Fetch } from "./hyperliquid-info";
import { fetchMarketMeta } from "./hyperliquid-info";
import { createSubscriptionGate } from "./subscription-gate";
import type { SubscriptionGate } from "./subscription-gate";
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
 * @returns A feed source; `select` switches precision on the live socket.
 */
export function createHyperliquidFeed(options: HyperliquidFeedOptions): FeedSource {
  let session: Session | undefined;
  return {
    start: (listener) => {
      const started = new Session(options, listener);
      session = started;
      return () => {
        started.stop();
        if (session === started) session = undefined;
      };
    },
    select: (coin, precision) => session?.select(coin, precision),
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
  private gate: SubscriptionGate | undefined;
  private wanted: Precision | undefined;
  private mark = 1;

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
      // A coin the venue does not list will never resolve; anything else is a
      // transient integration failure, and without a retry the widget stays
      // disconnected for the session even once connectivity returns.
      if (meta.error._tag !== "UnknownCoin" && !this.stopped) {
        clearTimeout(this.reconnect);
        this.reconnect = setTimeout(() => void this.boot(), RECONNECT_MS);
      }
      return;
    }
    const mark = meta.value.mark ?? 1;
    this.mark = mark;
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
      // A precision asked for before the socket opened (a `g` share link) is
      // adopted here, so the first subscription is already the wanted one.
      if (this.wanted !== undefined && this.scale !== undefined) {
        this.precision = this.wanted;
        this.wanted = undefined;
        this.listener({
          _tag: "market",
          market: { coin: this.options.coin, scale: this.scale, precision: this.precision, mark: this.mark },
          rx: Date.now(),
        });
      }
      if (this.precision !== undefined && this.scale !== undefined) {
        this.gate = createSubscriptionGate(this.precision, Grouping.gridTickFor(this.mark, this.precision, this.scale));
      }
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

  /**
   * Switch coin and/or precision. A change while another is still pending is
   * queued by the gate and fired when the outstanding acks land (ADR 0007).
   */
  readonly select = (coin: string, precision: Precision): void => {
    if (coin !== this.options.coin || this.scale === undefined) return;
    const ws = this.ws;
    // Desired precision is not transport state: while the socket is closed or
    // still opening, remember it and let the next `open` subscribe with it.
    // Mutating the old gate here would lose the choice on reconnect.
    if (this.gate === undefined || ws === undefined || ws.readyState !== ws.OPEN) {
      this.wanted = precision;
      return;
    }
    const action = this.gate.select(precision, Grouping.gridTickFor(this.mark, precision, this.scale));
    if (action._tag === "resubscribe") this.resubscribe(action.to);
  };

  /** Unsubscribe both books, announce the new market, then subscribe both. */
  private resubscribe(precision: Precision): void {
    const ws = this.ws;
    if (ws === undefined || ws.readyState !== ws.OPEN || this.scale === undefined) return;
    const previous = this.precision;
    if (previous !== undefined) {
      for (const stream of ["slow", "fast"] as const) {
        ws.send(
          JSON.stringify({
            method: "unsubscribe",
            subscription: bookSubscription(this.options.coin, stream, previous),
          }),
        );
      }
    }
    this.precision = precision;
    this.listener({
      _tag: "market",
      market: { coin: this.options.coin, scale: this.scale, precision, mark: this.mark },
      rx: Date.now(),
    });
    for (const stream of ["slow", "fast"] as const) {
      ws.send(
        JSON.stringify({ method: "subscribe", subscription: bookSubscription(this.options.coin, stream, precision) }),
      );
    }
  }

  /**
   * The same `nSigFigs` means a coarser or finer step once the mid crosses a
   * power of ten. The gate checks conformance against the grid, so it has to
   * follow: this is driven from `bbo`, which is not gated, so the new grid is
   * in force before the first book push that uses it.
   */
  private followDecade(mid: number): void {
    if (this.scale === undefined || this.precision === undefined || this.gate === undefined) return;
    if (!Number.isFinite(mid) || mid <= 0) return;
    if (Math.floor(Math.log10(mid)) === Math.floor(Math.log10(this.mark))) return;
    this.mark = mid;
    this.gate.adoptGrid(Grouping.gridTickFor(mid, this.precision, this.scale));
  }

  private bookSubscription(stream: DepthStream): Record<string, unknown> {
    return bookSubscription(this.options.coin, stream, this.precision ?? { _tag: "full" });
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
        if (ev.subscription._tag === "l2Book" && ev.method === "subscribe") {
          const queued = this.gate?.acked(ev.subscription.stream, ev.subscription.precision);
          if (queued?._tag === "resubscribe") this.resubscribe(queued.to);
        }
        break;
      case "l2Book": {
        const prices: number[] = [];
        for (const l of ev.bids) prices.push(l.px);
        for (const l of ev.asks) prices.push(l.px);
        if (this.gate?.accepts(ev.stream, prices) !== true) return;
        break;
      }
      case "bbo": {
        const bid = ev.bid?.px;
        const ask = ev.ask?.px;
        if (bid !== undefined && ask !== undefined) this.followDecade(((bid + ask) / 2) * 10 ** -this.scale.decimals);
        break;
      }
      case "trades":
        this.tradesHistorical = false;
        break;
      default:
        break;
    }
    this.listener(ev);
  }
}

/** The venue's `l2Book` subscription object; mantissa is only sent alongside sig-figs. */
function bookSubscription(coin: string, stream: DepthStream, precision: Precision): Record<string, unknown> {
  const sub: Record<string, unknown> = { type: "l2Book", coin };
  if (stream === "fast") sub["fast"] = true;
  if (precision._tag === "aggregated") {
    sub["nSigFigs"] = precision.nSigFigs;
    if (precision.mantissa !== undefined) sub["mantissa"] = precision.mantissa;
  }
  return sub;
}
