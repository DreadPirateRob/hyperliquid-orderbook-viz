import type { JSX } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, Settings as SettingsIcon } from "lucide-react";
import type { GroupOption } from "../domain/grouping";
import type { FeedSource } from "../data/feed-events.types";
import type { Fetch, MarketStats, MarketSummary } from "../data/hyperliquid-info";
import { fetchStats, fetchUniverse } from "../data/hyperliquid-info";
import { createInfoFetch } from "../data/info-cache";
import type { Prefs, PrefsStore } from "../state/prefs";
import { DEFAULT_PREFS } from "../state/prefs";
import { PairPicker } from "./pair-picker";
import { Settings } from "./settings";
import { createHyperliquidFeed } from "../data/hyperliquid-feed";
import type { Runtime, RuntimeState, RuntimeStatus, View } from "./runtime";
import { createRuntime } from "./runtime";
import { createPinchTracker } from "./pinch";
import { useAffordances } from "./use-affordances";

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
  /** Preferences store; omitted means defaults with no persistence. */
  readonly prefs?: PrefsStore;
  /** REST fetch; omitted uses the global one. */
  readonly fetch?: Fetch;
};

/** Grouping options and the one in use, mirrored from the runtime for the segment. */
type GroupSummary = {
  readonly options: ReadonlyArray<GroupOption>;
  readonly active: number | undefined;
};

/** The user-facing toggles the widget owns. */
export type WidgetState = {
  /** Market being watched. */
  readonly coin: string;
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
  const [metricsOn, setMetricsOn] = useState(props.prefs?.get().metricsOn ?? false);
  const [view, setView] = useState<View>(props.view ?? "ladder");
  const [gridTick, setGridTick] = useState<number | undefined>(props.gridTick);
  const [groups, setGroups] = useState<GroupSummary>({ options: [], active: undefined });
  const [coin, setCoin] = useState(props.coin);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [paused, setPaused] = useState(false);
  const [markets, setMarkets] = useState<ReadonlyArray<MarketSummary>>([]);
  const [stats, setStats] = useState<Record<string, MarketStats>>({});
  const [favourites, setFavourites] = useState<ReadonlyArray<string>>(props.prefs?.get().favourites ?? []);
  const [gearOpen, setGearOpen] = useState(false);
  const [settings, setSettings] = useState<Prefs>(props.prefs?.get() ?? DEFAULT_PREFS);
  const gearButtonRef = useRef<HTMLButtonElement>(null);
  const pairButtonRef = useRef<HTMLButtonElement>(null);
  const liveRef = useRef<HTMLParagraphElement>(null);
  const pinch = useRef(createPinchTracker());
  const lastAnnounce = useRef(0);
  const affordances = useAffordances(rootRef);
  // Width caps the user's toggles; it never turns a column the user switched off back on.
  const trailsShown = trailsOn && affordances.trails;
  const tapeShown = tapeOn && affordances.tape;
  const overlaysShown = overlaysOn && affordances.overlays;
  const viewShown = affordances.forcedView ?? view;
  const feedProp = props.feed;
  const prefs = props.prefs;
  // One shared, deduplicating fetch: feed boot, pair list and stats ask for the
  // same payloads, and the venue rate-limits `/info`.
  const fetchFn = useMemo(() => createInfoFetch(props.fetch ?? globalThis.fetch.bind(globalThis)), [props.fetch]);
  const onStateChange = props.onStateChange;

  // User-driven changes notify the embedder from the handler itself, not from an effect.
  const report = useCallback(
    (next: Partial<WidgetState>): void => {
      onStateChange?.({ coin, trailsOn, tapeOn, overlaysOn, view, gridTick, ...next });
    },
    [onStateChange, coin, trailsOn, tapeOn, overlaysOn, view, gridTick],
  );
  // State updaters stay pure: React may replay them, and StrictMode invokes
  // them twice on purpose. The outward notification (ADR 0008's `onStateChange`
  // seam) and preference writes happen once, here at the interaction boundary.
  const toggleTrails = useCallback(() => {
    const next = !trailsOn;
    setTrailsOn(next);
    report({ trailsOn: next });
  }, [report, trailsOn]);
  const toggleTape = useCallback(() => {
    const next = !tapeOn;
    setTapeOn(next);
    report({ tapeOn: next });
  }, [report, tapeOn]);
  const toggleOverlays = useCallback(() => {
    const next = !overlaysOn;
    setOverlaysOn(next);
    report({ overlaysOn: next });
  }, [report, overlaysOn]);
  const toggleView = useCallback(() => {
    const next = view === "ladder" ? "spine" : "ladder";
    setView(next);
    report({ view: next });
  }, [report, view]);
  const toggleMetrics = useCallback(() => {
    const next = !metricsOn;
    setMetricsOn(next);
    prefs?.set({ metricsOn: next });
  }, [prefs, metricsOn]);
  const togglePause = useCallback(() => setPaused((p) => !p), []);
  const toggleGear = useCallback(() => setGearOpen((open) => !open), []);
  const closeGear = useCallback(() => {
    setGearOpen(false);
    gearButtonRef.current?.focus();
  }, []);
  const changeSettings = useCallback(
    (patch: Partial<Prefs>): void => {
      prefs?.set(patch);
      setSettings(prefs?.get() ?? { ...settings, ...patch });
    },
    [prefs, settings],
  );
  const openPicker = useCallback(() => setPickerOpen(true), []);
  const closePicker = useCallback(() => {
    setPickerOpen(false);
    pairButtonRef.current?.focus();
  }, []);
  const selectCoin = useCallback(
    (next: string): void => {
      setPickerOpen(false);
      pairButtonRef.current?.focus();
      if (next === coin) return;
      // A coin change starts a fresh market: grouping follows the new default.
      setCoin(next);
      setGridTick(undefined);
      report({ coin: next, gridTick: undefined });
    },
    [coin, report],
  );
  const toggleFavourite = useCallback(
    (next: string): void => {
      prefs?.toggleFavourite(next);
      setFavourites(prefs?.get().favourites ?? []);
    },
    [prefs],
  );
  const selectGroup = useCallback(
    (step: number): void => {
      setGridTick(step);
      report({ gridTick: step });
    },
    [report],
  );
  /** `[` and `]` walk the option list from the one in use, or from the one just asked for (v4). */
  const stepGroup = useCallback(
    (direction: -1 | 1): void => {
      const list = groups.options;
      const index = list.findIndex((o) => o.gridTick === (gridTick ?? groups.active));
      const next = list[Math.min(list.length - 1, Math.max(0, (index < 0 ? 0 : index) + direction))];
      if (next !== undefined) selectGroup(next.gridTick);
    },
    [groups, gridTick, selectGroup],
  );

  /** Pointer y within the canvas, in CSS px. */
  const localY = useCallback((clientY: number): number => {
    const box = canvasRef.current?.getBoundingClientRect();
    return box === undefined ? 0 : clientY - box.top;
  }, []);
  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>): void => {
      pinch.current.down(e.pointerId, e.clientX, e.clientY);
      if (pinch.current.pinching()) runtimeRef.current?.setHover(undefined);
      else if (e.pointerType !== "mouse") runtimeRef.current?.setHover(localY(e.clientY));
    },
    [localY],
  );
  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>): void => {
      if (pinch.current.pinching()) {
        // Options run finest first, so spreading the fingers walks down the list.
        const step = pinch.current.move(e.pointerId, e.clientX, e.clientY);
        if (step !== undefined) stepGroup(step === "finer" ? -1 : 1);
        return;
      }
      pinch.current.move(e.pointerId, e.clientX, e.clientY);
      runtimeRef.current?.setHover(localY(e.clientY));
    },
    [localY, stepGroup],
  );
  const onPointerUp = useCallback((e: React.PointerEvent<HTMLCanvasElement>): void => {
    pinch.current.up(e.pointerId);
  }, []);
  const onPointerLeave = useCallback((e: React.PointerEvent<HTMLCanvasElement>): void => {
    pinch.current.up(e.pointerId);
    runtimeRef.current?.setHover(undefined);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetchUniverse(fetchFn).then((r) => {
      if (!cancelled && r._tag === "ok") setMarkets(r.value);
    });
    const poll = (): void => {
      void fetchStats(fetchFn).then((r) => {
        if (!cancelled && r._tag === "ok") setStats(r.value);
      });
    };
    poll();
    const timer = setInterval(poll, 10_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [fetchFn]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const feed =
      feedProp ??
      createHyperliquidFeed({ coin, precision: undefined, fetch: fetchFn, WebSocket: globalThis.WebSocket });
    const onStatus = (s: RuntimeStatus): void => {
      if (midRef.current !== null) midRef.current.textContent = s.mid;
      if (groupRef.current !== null) groupRef.current.textContent = s.groupLabel;
      if (connRef.current !== null) {
        connRef.current.textContent = s.connection;
        connRef.current.dataset["state"] = s.connection;
      }
      if (rootRef.current !== null) rootRef.current.dataset["connection"] = s.connection;
      if (hudRef.current !== null && s.hud !== "") hudRef.current.textContent = s.hud;
      // Text alternative for the canvas, plus a polite announcement at no more
      // than 1 Hz: the mid moves several times a second and a screen reader
      // reading every change is unusable (spec, story 42).
      const alternative = `${s.coin} order book, grouping ${s.groupLabel}, mid ${s.mid}, ${s.connection.toLowerCase()}`;
      canvas.setAttribute("aria-label", alternative);
      const now = performance.now();
      if (liveRef.current !== null && now - lastAnnounce.current >= 1000) {
        lastAnnounce.current = now;
        liveRef.current.textContent = alternative;
      }
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
  }, [feedProp, coin, fetchFn]);

  useEffect(() => {
    runtimeRef.current?.update({
      ...BASE_STATE,
      trailsOn: trailsShown,
      tapeOn: tapeShown,
      overlaysOn: overlaysShown,
      metricsOn,
      view: viewShown,
      gridTick,
      paused,
      cadence: settings.cadence,
      ruler: settings.ruler,
    });
  }, [trailsShown, tapeShown, overlaysShown, metricsOn, viewShown, gridTick, paused, settings]);

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
      if (e.key === "/") {
        e.preventDefault();
        openPicker();
      }
      if (e.key === "Escape") {
        // Close through the owners, not the raw setters: they return focus to
        // the trigger. Escape can arrive before a popover has taken focus.
        closeGear();
        closePicker();
      }
      if (e.key === " ") {
        e.preventDefault();
        togglePause();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    toggleTrails,
    toggleTape,
    toggleView,
    toggleOverlays,
    toggleMetrics,
    stepGroup,
    openPicker,
    togglePause,
    closeGear,
    closePicker,
  ]);

  return (
    <div
      className="orderbook"
      ref={rootRef}
      data-coin={coin}
      data-feed={feedProp === undefined ? "live" : "injected"}
      data-trails={trailsShown ? "1" : "0"}
      data-tape={tapeShown ? "1" : "0"}
      data-overlays={overlaysShown ? "1" : "0"}
      data-metrics={metricsOn ? "1" : "0"}
      data-view={viewShown}
      data-paused={paused ? "1" : "0"}
      data-sheet={affordances.sheet ? "1" : "0"}
      data-compact={affordances.forcedView === undefined ? "0" : "1"}
    >
      <div className="orderbook-bar">
        {/* Left: what market this is and what it is doing. Right: what the viewer can change. */}
        <div className="orderbook-barmarket">
          <button
            type="button"
            className="orderbook-pair"
            ref={pairButtonRef}
            onClick={openPicker}
            aria-haspopup="dialog"
          >
            {markets.find((m) => m.coin === coin)?.display ?? coin}
          </button>
          <Stat label="mid" size="lead">
            <span className="orderbook-mid" ref={midRef}>
              –
            </span>
          </Stat>
          <MarketStatsBar stats={stats[coin]} />
        </div>
        <div className="orderbook-barcontrols">
          <span className="orderbook-group" ref={groupRef}>
            –
          </span>
          <span className="orderbook-groupseg" role="group" aria-label="grouping">
            {groups.options.map((o) => (
              <GroupButton
                key={o.gridTick}
                option={o}
                active={o.gridTick === (gridTick ?? groups.active)}
                onSelect={selectGroup}
              />
            ))}
          </span>
          <button
            type="button"
            className="orderbook-toggle"
            aria-pressed={viewShown === "spine"}
            disabled={affordances.forcedView !== undefined}
            onClick={toggleView}
          >
            {viewShown}
          </button>
          <button
            type="button"
            className="orderbook-toggle"
            aria-pressed={trailsShown}
            disabled={!affordances.trails}
            onClick={toggleTrails}
          >
            trails
          </button>
          <button
            type="button"
            className="orderbook-toggle"
            aria-pressed={tapeShown}
            disabled={!affordances.tape}
            onClick={toggleTape}
          >
            tape
          </button>
          <button
            type="button"
            className="orderbook-toggle"
            aria-pressed={overlaysShown}
            disabled={!affordances.overlays}
            onClick={toggleOverlays}
          >
            overlays
          </button>
          <button type="button" className="orderbook-toggle" aria-pressed={metricsOn} onClick={toggleMetrics}>
            metrics
          </button>
          <button
            type="button"
            className="orderbook-toggle orderbook-icon"
            aria-pressed={paused}
            aria-label={paused ? "Resume" : "Pause"}
            onClick={togglePause}
          >
            {paused ? <Play size={12} aria-hidden /> : <Pause size={12} aria-hidden />}
          </button>
          <span className="orderbook-conn" ref={connRef} data-state="CONNECTING">
            CONNECTING
          </span>
          <button
            type="button"
            className="orderbook-toggle orderbook-icon"
            ref={gearButtonRef}
            aria-pressed={gearOpen}
            aria-label="Settings"
            aria-haspopup="dialog"
            onClick={toggleGear}
          >
            <SettingsIcon size={12} aria-hidden />
          </button>
        </div>
      </div>
      {pickerOpen ? (
        <PairPicker
          markets={markets}
          stats={stats}
          favourites={favourites}
          current={coin}
          onSelect={selectCoin}
          onToggleFavourite={toggleFavourite}
          onClose={closePicker}
        />
      ) : null}
      {gearOpen ? <Settings prefs={settings} onChange={changeSettings} onClose={closeGear} /> : null}
      <canvas
        className="orderbook-canvas"
        ref={canvasRef}
        role="img"
        aria-label={`${coin} order book ladder`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerLeave}
      />
      <p className="orderbook-live" ref={liveRef} role="status" aria-live="polite" />
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

/**
 * One captioned figure. v4 labels every number in the bar, and the port had
 * dropped the captions: a row of bare numbers does not say which is the mark
 * and which is funding.
 */
function Stat(props: {
  readonly label: string;
  readonly size?: "lead";
  readonly tone?: "up" | "dn";
  readonly children: React.ReactNode;
}): JSX.Element {
  return (
    <span className="orderbook-stat" data-size={props.size ?? "normal"} data-tone={props.tone ?? "flat"}>
      <span className="orderbook-stat-value">{props.children}</span>
      <span className="orderbook-stat-label">{props.label}</span>
    </span>
  );
}

/** Mark, 24 h change, volume and funding for the watched market. */
function MarketStatsBar(props: { readonly stats: MarketStats | undefined }): JSX.Element {
  const s = props.stats;
  if (s === undefined) return <span className="orderbook-stats" />;
  return (
    <span className="orderbook-stats">
      <Stat label="mark">
        {s.mark >= 1000 ? s.mark.toLocaleString("en-US", { maximumFractionDigits: 0 }) : s.mark.toFixed(4)}
      </Stat>
      {s.changePct === undefined ? null : (
        <Stat label="24h" tone={s.changePct >= 0 ? "up" : "dn"}>
          {`${s.changePct >= 0 ? "+" : ""}${s.changePct.toFixed(2)}%`}
        </Stat>
      )}
      {s.dayVolume === undefined ? null : <Stat label="24h vol">{formatVolume(s.dayVolume)}</Stat>}
      {s.funding === undefined ? null : <Stat label="funding">{`${(s.funding * 100).toFixed(4)}%`}</Stat>}
    </span>
  );
}

function formatVolume(volume: number): string {
  return volume >= 1e9 ? `${(volume / 1e9).toFixed(2)}B` : `${(volume / 1e6).toFixed(1)}M`;
}
