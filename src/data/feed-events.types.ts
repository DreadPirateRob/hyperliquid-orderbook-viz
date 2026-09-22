import type { Precision } from "../domain/grouping";
import type { Tick } from "../domain/tick";

/**
 * Feed events are what the data layer's adapters (socket, fixture reader)
 * emit after parsing the wire (ADR 0007). Prices are already ticks; sizes are
 * floats in coin units. `rx` is the adapter's receive time in ms.
 */

/** The two `l2Book` subscriptions: 20 levels at ~5 s, 5 levels at ~0.5 s. */
export type DepthStream = "slow" | "fast";

/** Which stream produced a book push; window authority follows from it. */
export type BookStream = DepthStream | "bbo";

/** Book side. */
export type Side = "bid" | "ask";

/** One resting level. `n` is the venue's order count at that price. */
export type Level = {
  readonly px: Tick;
  readonly sz: number;
  readonly n: number;
};

/** One print. `side` is the aggressor: `B` lifted the ask, `A` hit the bid. */
export type Trade = {
  readonly px: Tick;
  readonly sz: number;
  readonly side: "B" | "A";
  readonly time: number;
};

/** A subscription identity, used to gate acknowledgements. */
export type Subscription =
  | { readonly _tag: "l2Book"; readonly coin: string; readonly stream: DepthStream; readonly precision: Precision }
  | { readonly _tag: "bbo"; readonly coin: string }
  | { readonly _tag: "trades"; readonly coin: string };

/** Transport lifecycle, surfaced so the engine can drive connection state. */
export type ConnectionEvent =
  | { readonly _tag: "connecting" }
  | { readonly _tag: "open" }
  | { readonly _tag: "closed"; readonly reason: string }
  | { readonly _tag: "rejected"; readonly line: string; readonly why: string };

/**
 * Everything an adapter can emit. `tick` is the host clock: the engine never
 * reads time itself (ADR 0003), so staleness is detected on ticks.
 */
export type FeedEvent =
  | { readonly _tag: "l2Book"; readonly stream: DepthStream; readonly bids: ReadonlyArray<Level>; readonly asks: ReadonlyArray<Level>; readonly time: number; readonly rx: number }
  | { readonly _tag: "bbo"; readonly bid: Level | undefined; readonly ask: Level | undefined; readonly time: number; readonly rx: number }
  | { readonly _tag: "trades"; readonly trades: ReadonlyArray<Trade>; readonly historical: boolean; readonly rx: number }
  | { readonly _tag: "ack"; readonly subscription: Subscription; readonly rx: number }
  | { readonly _tag: "connection"; readonly event: ConnectionEvent; readonly rx: number }
  | { readonly _tag: "tick"; readonly rx: number };

/**
 * The port a widget consumes. The socket adapter and the fixture reader both
 * implement it; the widget never sees a WebSocket.
 */
export type FeedSource = {
  /** Start delivering events; returns the stop function. */
  readonly start: (listener: (event: FeedEvent) => void) => () => void;
  /** Switch coin and/or precision; the adapter serialises the resubscribe. */
  readonly select: (coin: string, precision: Precision) => void;
};
