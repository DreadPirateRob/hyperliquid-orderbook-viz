import type { JSX } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { GroupOption } from "../domain/grouping";
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
  /** Metric overlays on at mount; default on. */
  readonly overlays?: boolean;
  /** Grouping step in raw ticks at mount; omitted follows the market's default. */
  readonly gridTick?: number;
  /** View at mount; default `"ladder"`. */
  readonly view?: View;
  /** Reports every user-driven state change so an embedder can mirror it (URL, storage). */
  readonly onStateChange?: (state: WidgetState) => void;
};

/** Grouping options and the one in use, mirrored from the runtime for the segment. */
type GroupSummary = {
  readonly options: ReadonlyArray<GroupOption>;
  readonly active: number | undefined;
};

/** The user-facing toggles the widget owns. */
export type WidgetState = {
  /** Chosen grouping step in raw ticks, or `undefined` while following the default. */
  readonly gridTick: number | undefined;
  readonly trailsOn: boolean;
  readonly tapeOn: boolean;
  readonly overlaysOn: boolean;
  readonly view: View;
};

const BASE_STATE: RuntimeState = {
  view: "ladder",
  gridTick: undefined,
  notional: 100_000,
  trailsOn: true,
  tapeOn: true,
  overlaysOn: true,
  metricsOn: false,
  paused: false,
  cadence: "60",
  ruler: 12,
};

/**
 * The widget root. Owns the canvas surfaces and the chrome; data, state and
 * rendering live in plain TypeScript modules behind it (ADR 0003). Only
 * toggles go through React state; everything that changes per frame is
 * written by ref.
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
  const hudRef = useRef<HTMLPreElement>(null);
  const runtimeRef = useRef<Runtime | null>(null);
  const [trailsOn, setTrailsOn] = useState(props.trails ?? true);
  const [tapeOn, setTapeOn] = useState(props.tape ?? true);
  const [overlaysOn, setOverlaysOn] = useState(props.overlays ?? true);
  const [metricsOn, setMetricsOn] = useState(false);
  const [view, setView] = useState<View>(props.view ?? "ladder");
  const [gridTick, setGridTick] = useState<number | undefined>(props.gridTick);
  const [groups, setGroups] = useState<GroupSummary>({ options: [], active: undefined });
  const feedProp = props.feed;
  const coin = props.coin;
  const onStateChange = props.onStateChange;

  // User-driven changes notify the embedder from the handler itself, not from an effect.
  const report = useCallback(
    (next: Partial<WidgetState>): void => {
      onStateChange?.({ trailsOn, tapeOn, overlaysOn, view, gridTick, ...next });
    },
    [onStateChange, trailsOn, tapeOn, overlaysOn, view, gridTick],
  );
  const toggleTrails = useCallback(() => {
    setTrailsOn((on) => {
      report({ trailsOn: !on });
      return !on;
    });
  }, [report]);
  const toggleTape = useCallback(() => {
    setTapeOn((on) => {
      report({ tapeOn: !on });
      return !on;
    });
  }, [report]);
  const toggleOverlays = useCallback(() => {
    setOverlaysOn((on) => {
      report({ overlaysOn: !on });
      return !on;
    });
  }, [report]);
  const toggleView = useCallback(() => {
    setView((v) => {
      const next = v === "ladder" ? "spine" : "ladder";
      report({ view: next });
      return next;
    });
  }, [report]);
  const toggleMetrics = useCallback(() => setMetricsOn((on) => !on), []);
  const selectGroup = useCallback(
    (step: number): void => {
      setGridTick(step);
      report({ gridTick: step });
    },
    [report],
  );
  /** `[` and `]` walk the option list from the one in use (v4). */
  const stepGroup = useCallback(
    (direction: -1 | 1): void => {
      const list = groups.options;
      const index = list.findIndex((o) => o.gridTick === groups.active);
      const next = list[Math.min(list.length - 1, Math.max(0, (index < 0 ? 0 : index) + direction))];
      if (next !== undefined) selectGroup(next.gridTick);
    },
    [groups, selectGroup],
  );

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
      if (hudRef.current !== null && s.hud !== "") hudRef.current.textContent = s.hud;
      setGroups((prev) =>
        prev.active === s.gridTick && prev.options === s.groupOptions
          ? prev
          : { options: s.groupOptions, active: s.gridTick },
      );
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
    runtimeRef.current?.update({ ...BASE_STATE, trailsOn, tapeOn, overlaysOn, metricsOn, view, gridTick });
  }, [trailsOn, tapeOn, overlaysOn, metricsOn, view, gridTick]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.target instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (e.key === "t") toggleTrails();
      if (e.key === "p") toggleTape();
      if (e.key === "v") toggleView();
      if (e.key === "o") toggleOverlays();
      if (e.key === "m") toggleMetrics();
      if (e.key === "[") stepGroup(-1);
      if (e.key === "]") stepGroup(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleTrails, toggleTape, toggleView, toggleOverlays, toggleMetrics, stepGroup]);

  return (
    <div
      className="orderbook"
      ref={rootRef}
      data-coin={coin}
      data-feed={feedProp === undefined ? "live" : "injected"}
      data-trails={trailsOn ? "1" : "0"}
      data-tape={tapeOn ? "1" : "0"}
      data-overlays={overlaysOn ? "1" : "0"}
      data-metrics={metricsOn ? "1" : "0"}
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
        <span className="orderbook-groupseg" role="group" aria-label="grouping">
          {groups.options.map((o) => (
            <GroupButton key={o.gridTick} option={o} active={o.gridTick === groups.active} onSelect={selectGroup} />
          ))}
        </span>
        <button type="button" className="orderbook-toggle" aria-pressed={view === "spine"} onClick={toggleView}>
          {view}
        </button>
        <button type="button" className="orderbook-toggle" aria-pressed={trailsOn} onClick={toggleTrails}>
          trails
        </button>
        <button type="button" className="orderbook-toggle" aria-pressed={tapeOn} onClick={toggleTape}>
          tape
        </button>
        <button type="button" className="orderbook-toggle" aria-pressed={overlaysOn} onClick={toggleOverlays}>
          overlays
        </button>
        <button type="button" className="orderbook-toggle" aria-pressed={metricsOn} onClick={toggleMetrics}>
          metrics
        </button>
        <span className="orderbook-conn" ref={connRef} data-state="CONNECTING">
          CONNECTING
        </span>
      </div>
      <canvas className="orderbook-canvas" ref={canvasRef} role="img" aria-label={`${coin} order book ladder`} />
      {metricsOn ? (
        <div className="orderbook-hud">
          <pre ref={hudRef} />
        </div>
      ) : null}
    </div>
  );
}

/** One grouping step in the segmented control; its own component so the list does not rebuild callbacks. */
function GroupButton(props: {
  readonly option: GroupOption;
  readonly active: boolean;
  readonly onSelect: (gridTick: number) => void;
}): JSX.Element {
  const { option, onSelect } = props;
  const onClick = useCallback(() => onSelect(option.gridTick), [onSelect, option.gridTick]);
  return (
    <button type="button" className="orderbook-group-option" aria-pressed={props.active} onClick={onClick}>
      {option.label}
    </button>
  );
}
