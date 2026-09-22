import type { Tick } from "../domain/tick";

/**
 * Feed events are what the data layer's adapters (socket, fixture reader)
 * emit after parsing the wire (ADR 0007). Prices are already ticks; sizes are
 * floats in coin units. `rx` is the adapter's receive time in ms.
 */

/** Which stream produced a book push; window authority follows from it. */
export type BookStream = "slow" | "fast" | "bbo";

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

/** Precision the book streams were subscribed with; `undefined` = full. */
export type Precision = {
  readonly nSigFigs: number | undefined;
  readonly mantissa: number | undefined;
};

/** A book subscription identity, used to gate acknowledgements. */
export type BookSubscription = {
  readonly coin: string;
  readonly stream: "slow" | "fast";
  readonly precision: Precision;
};

/** Transport lifecycle, surfaced so the engine can drive connection state. */
export type ConnectionEvent =
  | { readonly _tag: "connecting" }
  | { readonly _tag: "open" }
  | { readonly _tag: "closed"; readonly reason: string }
  | { readonly _tag: "rejected"; readonly line: string; readonly why: string };

/** Everything an adapter can emit. */
export type FeedEvent =
  | { readonly _tag: "l2Book"; readonly stream: "slow" | "fast"; readonly bids: ReadonlyArray<Level>; readonly asks: ReadonlyArray<Level>; readonly time: number; readonly rx: number }
  | { readonly _tag: "bbo"; readonly bid: Level | undefined; readonly ask: Level | undefined; readonly time: number; readonly rx: number }
  | { readonly _tag: "trades"; readonly trades: ReadonlyArray<Trade>; readonly historical: boolean; readonly rx: number }
  | { readonly _tag: "ack"; readonly subscription: BookSubscription | { readonly coin: string; readonly stream: "bbo" | "trades" }; readonly rx: number }
  | { readonly _tag: "connection"; readonly event: ConnectionEvent; readonly rx: number };

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
