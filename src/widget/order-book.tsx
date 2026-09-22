import type { JSX } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FeedSource } from "../data/feed-events.types";
import { createHyperliquidFeed } from "../data/hyperliquid-feed";
import type { Runtime, RuntimeState, RuntimeStatus, View } from "./runtime";
import { createRuntime } from "./runtime";

/** Props seed the initial state only (ADR 0008); later changes are reported, not applied. */
export type OrderBookProps = {
  /** Initial coin, e.g. `"BTC"` or a spot pair id such as `"@107"`. */
  readonly coin: string;
  /** Feed to consume; omitted means the live Hyperliquid socket. */
  readonly feed?: FeedSource;
  /** Trails column on at mount; default on. */
  readonly trails?: boolean;
  /** Tape column on at mount; default on. */
  readonly tape?: boolean;
  /** View at mount; default `"ladder"`. */
  readonly view?: View;
  /** Reports every user-driven state change so an embedder can mirror it (URL, storage). */
  readonly onStateChange?: (state: WidgetState) => void;
};

/** The user-facing toggles the widget owns. */
export type WidgetState = {
  readonly trailsOn: boolean;
  readonly tapeOn: boolean;
  readonly view: View;
};

const BASE_STATE: RuntimeState = {
  view: "ladder",
  notional: 100_000,
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
  const [trailsOn, setTrailsOn] = useState(props.trails ?? true);
  const [tapeOn, setTapeOn] = useState(props.tape ?? true);
  const [view, setView] = useState<View>(props.view ?? "ladder");
  const feedProp = props.feed;
  const coin = props.coin;
  const onStateChange = props.onStateChange;
  // User-driven changes notify the embedder from the handler itself, not from an effect.
  const toggleTrails = useCallback(() => {
    setTrailsOn((on) => {
      onStateChange?.({ trailsOn: !on, tapeOn, view });
      return !on;
    });
  }, [onStateChange, tapeOn, view]);
  const toggleTape = useCallback(() => {
    setTapeOn((on) => {
      onStateChange?.({ trailsOn, tapeOn: !on, view });
      return !on;
    });
  }, [onStateChange, trailsOn, view]);
  const toggleView = useCallback(() => {
    setView((v) => {
      const next = v === "ladder" ? "spine" : "ladder";
      onStateChange?.({ trailsOn, tapeOn, view: next });
      return next;
    });
  }, [onStateChange, trailsOn, tapeOn]);

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
    // Seeded with the base state; the sync effect below pushes the current toggles right after mount.
    const runtime = createRuntime({ canvas, feed, state: BASE_STATE, onStatus });
    runtimeRef.current = runtime;
    return () => {
      runtime.dispose();
      runtimeRef.current = null;
    };
  }, [feedProp, coin]);

  useEffect(() => {
    runtimeRef.current?.update({ ...BASE_STATE, trailsOn, tapeOn, view });
  }, [trailsOn, tapeOn, view]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (e.key === "t") toggleTrails();
      if (e.key === "p") toggleTape();
      if (e.key === "v") toggleView();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleTrails, toggleTape, toggleView]);

  return (
    <div
      className="orderbook"
      ref={rootRef}
      data-coin={coin}
      data-feed={feedProp === undefined ? "live" : "injected"}
      data-trails={trailsOn ? "1" : "0"}
      data-tape={tapeOn ? "1" : "0"}
      data-view={view}
    >
      <div className="orderbook-bar">
        <span className="orderbook-pair">{coin}</span>
        <span className="orderbook-mid" ref={midRef}>
          –
        </span>
        <span className="orderbook-group" ref={groupRef}>
          –
        </span>
        <button type="button" className="orderbook-toggle" aria-pressed={trailsOn} onClick={toggleTrails}>
          trails
        </button>
        <button type="button" className="orderbook-toggle" aria-pressed={tapeOn} onClick={toggleTape}>
          tape
        </button>
        <span className="orderbook-conn" ref={connRef} data-state="CONNECTING">
          CONNECTING
        </span>
      </div>
      <canvas className="orderbook-canvas" ref={canvasRef} role="img" aria-label={`${coin} order book ladder`} />
    </div>
  );
}
