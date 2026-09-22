import type { Tick } from "../domain/tick";
import type { BookStream, FeedEvent, Level, Side, Trade } from "./feed-events.types";

/**
 * The engine is the data layer's core (ADR 0001, 0003): it fuses the four
 * streams into one book and reports what changed. The state layer pulls from
 * it; nothing pushes out. Every type here is structured-clone safe so the
 * engine can move to a Worker (ADR 0004).
 */

/** Widget-visible connection state (spec, story 43). */
export type ConnectionState =
  | "CONNECTING"
  | "SUBSCRIBING"
  | "LIVE"
  | "STALE"
  | "RESYNCING"
  | "DISCONNECTED";

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
  readonly convexity: number;
  /** Cumulative curve, best outward, for the shape sparkline. */
  readonly shape: ReadonlyArray<number>;
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

/** The engine's pull API. */
export type Engine = {
  /** Fold one feed event into the book. */
  readonly apply: (event: FeedEvent) => void;
  /** Current book; same object until the version changes. */
  readonly snapshot: () => BookSnapshot;
  /** Level events since the previous drain, in arrival order. */
  readonly drain: () => ReadonlyArray<LevelEvent>;
  /** Derived metrics at `notional` quote units; cached per version. */
  readonly metrics: (notional: number) => Metrics;
  /** Forget everything; used on coin and precision change. */
  readonly reset: () => void;
};
