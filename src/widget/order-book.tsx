import type { JSX } from "react";
import type { FeedSource } from "../data/feed-events.types";

/** Props seed the initial state only (ADR 0008); later changes are reported, not applied. */
export type OrderBookProps = {
  /** Initial coin, e.g. `"BTC"` or a spot pair id such as `"@107"`. */
  readonly coin: string;
  /** Feed to consume; omitted means the live Hyperliquid socket. */
  readonly feed?: FeedSource;
};

/**
 * The widget root. Owns the canvas surfaces and the chrome; data, state and
 * rendering live in plain TypeScript modules behind it (ADR 0003).
 *
 * @param props - Initial state.
 * @returns The widget element.
 */
export function OrderBook(props: OrderBookProps): JSX.Element {
  return (
    <div className="orderbook" data-coin={props.coin} data-feed={props.feed === undefined ? "live" : "injected"} />
  );
}
