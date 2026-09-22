import type { PriceScale, Tick } from "../domain/tick";
import type { BookStream, FeedEvent, Level, Side, Trade } from "./feed-events.types";

/**
 * The engine is the data layer's core (ADR 0001, 0003): it fuses the four
 * streams into one book and reports what changed. The state layer pulls from
 * it; nothing pushes out. Every type here is structured-clone safe so the
 * engine can move to a Worker (ADR 0004).
 */

/** Widget-visible connection state (spec, story 43). */
export type ConnectionState = "CONNECTING" | "SUBSCRIBING" | "LIVE" | "STALE" | "RESYNCING" | "DISCONNECTED";

/** Immutable view of the fused book at one version. */
export type BookSnapshot = {
  readonly version: number;
  readonly bids: ReadonlyArray<Level>;
  readonly asks: ReadonlyArray<Level>;
  readonly bestBid: Level | undefined;
  readonly bestAsk: Level | undefined;
  readonly lastTrade: Trade | undefined;
  readonly connection: ConnectionState;
};

/**
 * What one push did to one level. `consumed`/`cancelled` split a decrease by
 * temporal trade join; `confidence` is always heuristic (ADR 0005).
 */
export type LevelEvent = {
  readonly side: Side;
  readonly px: Tick;
  readonly kind: "added" | "grew" | "shrank" | "vanished" | "outOfWindow" | "migrated";
  readonly from: number;
  readonly to: number;
  readonly consumed: number;
  readonly cancelled: number;
  readonly stream: BookStream;
  readonly time: number;
};

/** One side's execution cost for a notional (Derived Metrics §8). */
export type ExecutionCost = {
  readonly vwap: number;
  readonly slippageBps: number;
  readonly filledFraction: number;
  readonly levels: number;
  readonly exceedsVisibleDepth: boolean;
};

/** Per-side figures the HUD shows (Derived Metrics §3, §6, §7, §10). */
export type SideMetrics = {
  readonly eventChurn: number;
  readonly volumeChurn: number;
  readonly cancelRatioCount: number;
  readonly cancelRatioVolume: number;
  readonly medianRefillMs: number | undefined;
  readonly refillAt5s: number | undefined;
  readonly convexity: number | undefined;
  /** Cumulative curve, best outward, for the shape sparkline. */
  readonly shape: ReadonlyArray<number>;
};

/** A level being watched for refill after losing at least half its size. */
export type LevelWatch = {
  readonly startedAt: number;
  readonly before: number;
  /** Refill time in ms, `Infinity` when capped, `undefined` while pending. */
  readonly done: number | undefined;
  /** Size ratio five seconds in, `undefined` while pending. */
  readonly at5s: number | undefined;
};

/** Book-wide metrics, recomputed lazily when the version changes. */
export type Metrics = {
  readonly version: number;
  readonly share: number;
  readonly imbalance5: number;
  readonly micro: number;
  /** Σ field(bid) − Σ field(ask) (ADR 0005). */
  readonly pressure: number;
  readonly bid: SideMetrics;
  readonly ask: SideMetrics;
  readonly costBuy: ExecutionCost;
  readonly costSell: ExecutionCost;
};

/** A level that appears to have been repriced within one fast push (heuristic). */
export type Migration = {
  readonly side: Side;
  readonly from: Tick;
  readonly to: Tick;
  /** Frame time the pairing was observed. */
  readonly t: number;
};

/** Engine configuration; `gridTick` gates which BBO prices may enter the book (v4 `onGrid`). */
export type EngineConfig = {
  readonly gridTick: number;
  /** Price scale, needed to price execution cost in quote units. */
  readonly scale?: PriceScale | undefined;
};

/** The engine's pull API. */
export type Engine = {
  /** Fold one feed event into the book. */
  readonly apply: (event: FeedEvent) => void;
  /** Current book; same object until the version changes. */
  readonly snapshot: () => BookSnapshot;
  /** Level events since the previous drain, in arrival order. */
  readonly drain: () => ReadonlyArray<LevelEvent>;
  /** Live prints since the previous drain (historical backlog excluded). */
  readonly drainTrades: () => ReadonlyArray<Trade>;
  /** Repricing pairs since the previous drain. */
  readonly drainMigrations: () => ReadonlyArray<Migration>;
  /** Decayed size-delta field for one price (ADR 0005). */
  readonly field: (side: Side, px: Tick) => number;
  /** Live resiliency watch for one price, if any. */
  readonly watch: (side: Side, px: Tick) => LevelWatch | undefined;
  /** Derived metrics at `notional` quote units; cached per version. */
  readonly metrics: (notional: number) => Metrics;
  /** Forget everything and adopt a new grid; used on coin and precision change. Enters `RESYNCING`. */
  readonly reset: (config: EngineConfig) => void;
};
