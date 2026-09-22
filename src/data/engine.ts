import type { PriceScale } from "../domain/tick";
import type { Tick } from "../domain/tick";
import { casesHandled } from "../shared/result";
import { createAttribution } from "./attribution";
import type { Attribution } from "./attribution";
import type {
  BookSnapshot,
  ConnectionState,
  Engine,
  EngineConfig,
  LevelEvent,
  Metrics,
  Migration,
  SideMetrics,
} from "./engine-api.types";
import type { BookStream, FeedEvent, Level, Side, Trade } from "./feed-events.types";
import { createLevelStats } from "./level-stats";
import type { LevelStats } from "./level-stats";
import { convexity, executionCost } from "./metrics";

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
  return new BookEngine(config);
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
  private cachedMetrics: Metrics | undefined;
  private cachedNotional = Number.NaN;
  private readonly attribution: Attribution = createAttribution();
  private readonly stats: LevelStats = createLevelStats();
  private migrations: Migration[] = [];
  private now = 0;
  private gridTick: number;
  private scale: PriceScale | undefined;

  constructor(config: EngineConfig) {
    this.gridTick = config.gridTick;
    this.scale = config.scale;
  }

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
          this.attribution.addTrade(t, event.rx);
        }
        if (event.trades.length > 0) {
          this.settleAttribution(event.rx);
          this.bump();
        }
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
        this.now = event.rx;
        this.attribution.prune(event.rx);
        this.settleAttribution(event.rx);
        this.stats.tick(event.rx);
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

  readonly drainMigrations = (): ReadonlyArray<Migration> => {
    const out = this.migrations;
    this.migrations = [];
    return out;
  };

  readonly drainTrades = (): ReadonlyArray<Trade> => {
    const out = this.trades;
    this.trades = [];
    return out;
  };

  readonly metrics = (notional: number): Metrics => {
    const cached = this.cachedMetrics;
    if (cached !== undefined && this.cachedNotional === notional) return cached;
    const snapshot = this.snapshot();
    const bb = this.bestBid ?? snapshot.bids[0];
    const aa = this.bestAsk ?? snapshot.asks[0];
    const share = bb !== undefined && aa !== undefined && bb.sz + aa.sz > 0 ? bb.sz / (bb.sz + aa.sz) : 0.5;
    const unit = this.scale === undefined ? 1 : 10 ** -this.scale.decimals;
    const mid = bb !== undefined && aa !== undefined ? ((bb.px + aa.px) / 2) * unit : Number.NaN;
    const fiveBid = sumTop(snapshot.bids, 5);
    const fiveAsk = sumTop(snapshot.asks, 5);
    const metrics: Metrics = {
      version: this.version,
      share,
      imbalance5: fiveBid + fiveAsk > 0 ? (fiveBid - fiveAsk) / (fiveBid + fiveAsk) : 0,
      micro: bb !== undefined && aa !== undefined ? (bb.px + share * (aa.px - bb.px)) * unit : Number.NaN,
      pressure: this.stats.fieldSum("bid", this.now) - this.stats.fieldSum("ask", this.now),
      bid: this.sideMetrics("bid", snapshot.bids),
      ask: this.sideMetrics("ask", snapshot.asks),
      costBuy: this.cost(snapshot.asks, notional, mid),
      costSell: this.cost(snapshot.bids, notional, mid),
    };
    this.cachedMetrics = metrics;
    this.cachedNotional = notional;
    return metrics;
  };

  /** Field value for one price, for the size-delta strip. */
  readonly field = (side: Side, px: Tick): number => this.stats.fieldAt(side, px, this.now);

  /** Live resiliency watch for one price, for the refill bar. */
  readonly watch = (side: Side, px: Tick) => this.stats.watch(side, px);

  private sideMetrics(side: Side, levels: ReadonlyArray<Level>): SideMetrics {
    const w = this.stats.window(side, this.now);
    return { ...w, convexity: convexity(levels) };
  }

  private cost(levels: ReadonlyArray<Level>, notional: number, mid: number) {
    if (this.scale === undefined) {
      return { vwap: Number.NaN, slippageBps: Number.NaN, filledFraction: 0, levels: 0, exceedsVisibleDepth: true };
    }
    return executionCost(levels, notional, mid, this.scale);
  }

  /** Move late-attributed volume from cancelled to consumed (ADR 0005). */
  private settleAttribution(t: number): void {
    for (const moved of this.attribution.reattribute(t)) {
      this.stats.reattribute(moved.side, moved.px, moved.consumed, moved.cancelled);
    }
  }

  readonly reset = (config: EngineConfig): void => {
    this.gridTick = config.gridTick;
    this.sides.bid.length = 0;
    this.sides.ask.length = 0;
    if (config.keepTouch !== true) {
      this.bestBid = undefined;
      this.bestAsk = undefined;
      this.lastTrade = undefined;
    }
    this.lastFastRx = 0;
    this.lastSlowRx = 0;
    this.events = [];
    this.trades = [];
    this.stats.clear();
    this.attribution.clear();
    this.migrations = [];
    this.scale = config.scale;
    this.connection = "RESYNCING";
    this.bump();
  };

  private bump(): void {
    this.version++;
    this.cached = undefined;
    this.cachedMetrics = undefined;
  }

  /**
   * Emit one level event and fold it into the metric state: a decrease is
   * split into consumed/cancelled by the prints in this stream's push window
   * and stays open for late re-attribution. BBO flicker is excluded from the
   * per-side aggregates (ADR 0007) but still moves the size-delta field.
   */
  private record(
    side: Side,
    px: Tick,
    kind: LevelEvent["kind"],
    from: number,
    to: number,
    stream: BookStream,
    rx: number,
  ): void {
    const windowStart =
      stream === "slow"
        ? this.lastSlowRx
        : stream === "fast"
          ? this.lastFastRx
          : Math.max(this.lastSlowRx, this.lastFastRx);
    const decrease = from - to;
    const split =
      decrease > 0 && kind !== "outOfWindow"
        ? this.attribution.split(side, px, decrease, windowStart, rx)
        : { consumed: 0, cancelled: 0 };
    if (kind !== "outOfWindow") {
      this.stats.change(side, px, from, to, rx, stream !== "bbo", split);
      if (decrease > 0) this.attribution.openPending(side, px, decrease, split, windowStart, rx);
    }
    this.events.push({
      side,
      px,
      kind,
      from,
      to,
      consumed: split.consumed,
      cancelled: split.cancelled,
      stream,
      time: rx,
    });
    this.now = rx;
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
    const before = this.events.length;
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
        // SAFETY: store prices are copies of parsed ticks.
        const tickPx = opx as Tick;
        if (stream === "slow") this.record(side, tickPx, "vanished", osz, 0, stream, rx);
        else if (best !== undefined && better(side, opx, best.px))
          this.record(side, tickPx, "outOfWindow", osz, 0, stream, rx);
        else if (worst !== undefined && !better(side, worst.px, opx))
          this.record(side, tickPx, "vanished", osz, 0, stream, rx);
        else push(out, opx, osz, s.n[i] ?? 0);
        i++;
      } else if (nx !== undefined && (opx === undefined || better(side, nx.px, opx))) {
        this.record(side, nx.px, "added", 0, nx.sz, stream, rx);
        push(out, nx.px, nx.sz, nx.n);
        j++;
      } else if (nx !== undefined) {
        const osz = s.sz[i] ?? 0;
        if (nx.sz < osz) this.record(side, nx.px, "shrank", osz, nx.sz, stream, rx);
        else if (nx.sz > osz) this.record(side, nx.px, "grew", osz, nx.sz, stream, rx);
        push(out, nx.px, nx.sz, nx.n);
        i++;
        j++;
      }
    }
    this.scratch = s;
    this.sides[side] = out;
    if (stream === "fast") this.pairMigrations(before, rx);
  }

  /**
   * Heuristic repricing: a level that vanished and one that appeared in the
   * same fast push, same side, within 10 % size and 3 grid ticks, is reported
   * as `migrated` (Derived Metrics §9). Confidence is heuristic by nature.
   */
  private pairMigrations(from: number, rx: number): void {
    const vanished = [];
    const added = [];
    for (let i = from; i < this.events.length; i++) {
      const e = this.events[i];
      if (e === undefined) continue;
      if (e.kind === "vanished") vanished.push(e);
      else if (e.kind === "added") added.push(e);
    }
    for (const v of vanished) {
      for (const a of added) {
        if (Math.abs(a.to - v.from) > 0.1 * v.from) continue;
        if (Math.abs(a.px - v.px) > 3 * this.gridTick) continue;
        this.migrations.push({ side: v.side, from: v.px, to: a.px, t: rx });
        break;
      }
    }
  }
}

/** Sum of the first `n` levels' sizes, for the N-level imbalance. */
function sumTop(levels: ReadonlyArray<Level>, n: number): number {
  let sum = 0;
  for (let i = 0; i < Math.min(n, levels.length); i++) sum += levels[i]?.sz ?? 0;
  return sum;
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
