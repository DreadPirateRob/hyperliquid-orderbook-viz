import type { JSX } from "react";
import { useEffect, useRef } from "react";
import type { FeedSource } from "../data/feed-events.types";
import { createHyperliquidFeed } from "../data/hyperliquid-feed";
import type { Runtime, RuntimeState, RuntimeStatus } from "./runtime";
import { createRuntime } from "./runtime";

/** Props seed the initial state only (ADR 0008); later changes are reported, not applied. */
export type OrderBookProps = {
  /** Initial coin, e.g. `"BTC"` or a spot pair id such as `"@107"`. */
  readonly coin: string;
  /** Feed to consume; omitted means the live Hyperliquid socket. */
  readonly feed?: FeedSource;
};

const INITIAL_STATE: RuntimeState = {
  trailsOn: true,
  tapeOn: true,
  overlaysOn: true,
  paused: false,
  cadence: "60",
  ruler: 12,
};

/**
 * The widget root. Owns the canvas surfaces and the chrome; data, state and
 * rendering live in plain TypeScript modules behind it (ADR 0003).
 *
 * @param props - Initial state.
 * @returns The widget element.
 */
export function OrderBook(props: OrderBookProps): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const midRef = useRef<HTMLSpanElement>(null);
  const connRef = useRef<HTMLSpanElement>(null);
  const groupRef = useRef<HTMLSpanElement>(null);
  const runtimeRef = useRef<Runtime | null>(null);
  const feedProp = props.feed;
  const coin = props.coin;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const feed =
      feedProp ??
      createHyperliquidFeed({
        coin,
        precision: undefined,
        fetch: globalThis.fetch.bind(globalThis),
        WebSocket: globalThis.WebSocket,
      });
    const onStatus = (s: RuntimeStatus): void => {
      if (midRef.current !== null) midRef.current.textContent = s.mid;
      if (groupRef.current !== null) groupRef.current.textContent = s.groupLabel;
      if (connRef.current !== null) {
        connRef.current.textContent = s.connection;
        connRef.current.dataset["state"] = s.connection;
      }
      if (rootRef.current !== null) rootRef.current.dataset["connection"] = s.connection;
    };
    const runtime = createRuntime({ canvas, feed, state: INITIAL_STATE, onStatus });
    runtimeRef.current = runtime;
    return () => {
      runtime.dispose();
      runtimeRef.current = null;
    };
  }, [feedProp, coin]);

  return (
    <div className="orderbook" ref={rootRef} data-coin={coin} data-feed={feedProp === undefined ? "live" : "injected"}>
      <div className="orderbook-bar">
        <span className="orderbook-pair">{coin}</span>
        <span className="orderbook-mid" ref={midRef}>
          –
        </span>
        <span className="orderbook-group" ref={groupRef}>
          –
        </span>
        <span className="orderbook-conn" ref={connRef} data-state="CONNECTING">
          CONNECTING
        </span>
      </div>
      <canvas className="orderbook-canvas" ref={canvasRef} role="img" aria-label={`${coin} order book ladder`} />
    </div>
  );
}
