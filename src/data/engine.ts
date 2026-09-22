import type { Tick } from "../domain/tick";
import { casesHandled, notYetImplemented } from "../shared/result";
import type { BookSnapshot, ConnectionState, Engine, EngineConfig, LevelEvent } from "./engine-api.types";
import type { BookStream, FeedEvent, Level, Side, Trade } from "./feed-events.types";

/**
 * Snapshot-native engine (ADR 0001, 0007). Each side is a pair of typed
 * arrays sorted best-first; a push replaces the window it is authoritative
 * for: slow = whole side, fast = [lo, hi] of its levels, bbo = the touch.
 * The diff between old and new window is reported as level events.
 */

/** v4's staleness thresholds (ms). */
const STALE_FAST_MS = 3000;
const STALE_SLOW_MS = 20000;

type SideStore = {
  px: Float64Array;
  sz: Float64Array;
  n: Int32Array;
  length: number;
};

function makeSide(capacity: number): SideStore {
  return { px: new Float64Array(capacity), sz: new Float64Array(capacity), n: new Int32Array(capacity), length: 0 };
}

/**
 * Create an engine. Time only ever arrives on events.
 *
 * @param config - Grid in raw ticks.
 * @returns A fresh engine in `CONNECTING`.
 */
export function createEngine(config: EngineConfig): Engine {
  return new BookEngine(config.gridTick);
}

class BookEngine implements Engine {
  private readonly sides: Record<Side, SideStore> = { bid: makeSide(64), ask: makeSide(64) };
  private scratch: SideStore = makeSide(64);
  private events: LevelEvent[] = [];
  private trades: Trade[] = [];
  private version = 0;
  private connection: ConnectionState = "CONNECTING";
  private bestBid: Level | undefined;
  private bestAsk: Level | undefined;
  private lastTrade: Trade | undefined;
  private lastFastRx = 0;
  private lastSlowRx = 0;
  private cached: BookSnapshot | undefined;

  constructor(private gridTick: number) {}

  readonly apply = (event: FeedEvent): void => {
    switch (event._tag) {
      case "l2Book":
        this.applyWindow("bid", event.bids, event.stream, event.rx);
        this.applyWindow("ask", event.asks, event.stream, event.rx);
        if (event.stream === "fast") this.lastFastRx = event.rx;
        else this.lastSlowRx = event.rx;
        this.connection = "LIVE";
        this.bump();
        return;
      case "bbo":
        if (event.bid !== undefined) this.applyTouch("bid", event.bid, event.rx);
        if (event.ask !== undefined) this.applyTouch("ask", event.ask, event.rx);
        this.bump();
        return;
      case "trades":
        if (event.historical) return;
        for (const t of event.trades) {
          this.lastTrade = t;
          this.trades.push(t);
        }
        if (event.trades.length > 0) this.bump();
        return;
      case "ack":
      case "market":
        return;
      case "connection":
        switch (event.event._tag) {
          case "connecting":
            this.connection = "CONNECTING";
            break;
          case "open":
            this.connection = "SUBSCRIBING";
            break;
          case "closed":
            this.connection = "DISCONNECTED";
            break;
          case "rejected":
            return;
          default:
            casesHandled(event.event);
        }
        this.bump();
        return;
      case "tick": {
        const stale =
          (this.lastFastRx > 0 && event.rx - this.lastFastRx > STALE_FAST_MS) ||
          (this.lastSlowRx > 0 && event.rx - this.lastSlowRx > STALE_SLOW_MS);
        if (stale && this.connection === "LIVE") {
          this.connection = "STALE";
          this.bump();
        }
        return;
      }
      default:
        casesHandled(event);
    }
  };

  readonly snapshot = (): BookSnapshot => {
    if (this.cached !== undefined) return this.cached;
    this.cached = {
      version: this.version,
      bids: sideLevels(this.sides.bid),
      asks: sideLevels(this.sides.ask),
      bestBid: this.bestBid,
      bestAsk: this.bestAsk,
      lastTrade: this.lastTrade,
      connection: this.connection,
    };
    return this.cached;
  };

  readonly drain = (): ReadonlyArray<LevelEvent> => {
    const out = this.events;
    this.events = [];
    return out;
  };

  readonly drainTrades = (): ReadonlyArray<Trade> => {
    const out = this.trades;
    this.trades = [];
    return out;
  };

  readonly metrics = (): never => notYetImplemented("engine metrics land with the overlays ticket");

  readonly reset = (config: EngineConfig): void => {
    this.gridTick = config.gridTick;
    this.sides.bid.length = 0;
    this.sides.ask.length = 0;
    this.bestBid = undefined;
    this.bestAsk = undefined;
    this.lastTrade = undefined;
    this.lastFastRx = 0;
    this.lastSlowRx = 0;
    this.events = [];
    this.trades = [];
    this.connection = "RESYNCING";
    this.bump();
  };

  private bump(): void {
    this.version++;
    this.cached = undefined;
  }

  /** BBO owns the touch (v4 `applyBbo`): its price enters the book only when on grid. */
  private applyTouch(side: Side, level: Level, rx: number): void {
    if (side === "bid") this.bestBid = level;
    else this.bestAsk = level;
    if (level.px % this.gridTick !== 0) return;
    this.applyWindow(side, [level], "bbo", rx);
  }

  /**
   * Replace the window of `side` that `stream` is authoritative for with
   * `incoming` (ADR 0007): the whole side for slow; from the touch down to
   * the worst incoming level for fast and bbo, so anything better than the
   * push's best is stale by construction. Both sequences are best-first, so
   * this is one merge pass producing the diff.
   */
  private applyWindow(side: Side, incoming: ReadonlyArray<Level>, stream: BookStream, rx: number): void {
    const s = this.sides[side];
    const best = incoming[0];
    const worst = incoming[incoming.length - 1];
    if (stream !== "slow" && (best === undefined || worst === undefined)) return;
    const out = this.scratch;
    ensure(out, s.length + incoming.length);
    out.length = 0;
    let i = 0;
    let j = 0;
    while (i < s.length || j < incoming.length) {
      const opx = i < s.length ? (s.px[i] ?? 0) : undefined;
      const nx = incoming[j];
      if (opx !== undefined && (nx === undefined || better(side, opx, nx.px))) {
        const osz = s.sz[i] ?? 0;
        if (stream === "slow") this.events.push(levelEvent(side, opx, "vanished", osz, 0, stream, rx));
        else if (best !== undefined && better(side, opx, best.px))
          this.events.push(levelEvent(side, opx, "outOfWindow", osz, 0, stream, rx));
        else if (worst !== undefined && !better(side, worst.px, opx))
          this.events.push(levelEvent(side, opx, "vanished", osz, 0, stream, rx));
        else push(out, opx, osz, s.n[i] ?? 0);
        i++;
      } else if (nx !== undefined && (opx === undefined || better(side, nx.px, opx))) {
        this.events.push(levelEvent(side, nx.px, "added", 0, nx.sz, stream, rx));
        push(out, nx.px, nx.sz, nx.n);
        j++;
      } else if (nx !== undefined) {
        const osz = s.sz[i] ?? 0;
        if (nx.sz < osz) this.events.push(levelEvent(side, nx.px, "shrank", osz, nx.sz, stream, rx));
        else if (nx.sz > osz) this.events.push(levelEvent(side, nx.px, "grew", osz, nx.sz, stream, rx));
        push(out, nx.px, nx.sz, nx.n);
        i++;
        j++;
      }
    }
    this.scratch = s;
    this.sides[side] = out;
  }
}

function better(side: Side, a: number, b: number): boolean {
  return side === "bid" ? a > b : a < b;
}

function ensure(s: SideStore, capacity: number): void {
  if (s.px.length >= capacity) return;
  let c = s.px.length;
  while (c < capacity) c *= 2;
  s.px = new Float64Array(c);
  s.sz = new Float64Array(c);
  s.n = new Int32Array(c);
}

function push(s: SideStore, px: number, sz: number, n: number): void {
  ensure(s, s.length + 1);
  s.px[s.length] = px;
  s.sz[s.length] = sz;
  s.n[s.length] = n;
  s.length++;
}

function sideLevels(s: SideStore): ReadonlyArray<Level> {
  const out: Level[] = [];
  for (let i = 0; i < s.length; i++) {
    // SAFETY: the store only ever holds integers written from parsed ticks.
    out.push({ px: (s.px[i] ?? 0) as Tick, sz: s.sz[i] ?? 0, n: s.n[i] ?? 0 });
  }
  return out;
}

function levelEvent(
  side: Side,
  px: number,
  kind: LevelEvent["kind"],
  from: number,
  to: number,
  stream: BookStream,
  time: number,
): LevelEvent {
  // SAFETY: as above; `px` originates from a Tick and is only ever copied.
  return { side, px: px as Tick, kind, from, to, consumed: 0, cancelled: 0, stream, time };
}
