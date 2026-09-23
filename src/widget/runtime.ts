import type { Engine } from "../data/engine-api.types";
import { createEngine } from "../data/engine";
import type { FeedSource, MarketInfo } from "../data/feed-events.types";
import * as Grouping from "../domain/grouping";
import type { GroupOption } from "../domain/grouping";
import type { PriceScale } from "../domain/tick";
import * as Tick from "../domain/tick";
import { drawLadder } from "../render/ladder";
import { drawSpine } from "../render/spine";
import { drawTape } from "../render/tape";
import { PALETTE } from "../render/palette";
import { createLevelHistory } from "../state/level-history";
import { createTape } from "../state/tape";
import { TRAIL_DT } from "../state/trail";
import { hudText } from "./hud";
import type { Sampler } from "../state/sampler";
import { createSampler } from "../state/sampler";
import type { FrameSample } from "../state/frame-sample.types";
import type { BookSnapshot, ConnectionState } from "../data/engine-api.types";

/**
 * The imperative shell behind `<OrderBook>` (ADR 0008): owns the engine,
 * sampler, canvas, frame loop, host ticks and the feed subscription. React
 * hands it a canvas and a state object; it never re-renders for frames.
 */

/** Frame cadence (v4's `fpsMode`). */
export type Cadence = "60" | "30" | "update";

/** Which ladder construction is drawn. */
export type View = "ladder" | "spine";

/** What the runtime reads from widget state each frame. */
export type RuntimeState = {
  readonly view: View;
  /** Chosen grouping step in raw ticks; `undefined` follows the market's default. */
  readonly gridTick: number | undefined;
  readonly trailsOn: boolean;
  readonly tapeOn: boolean;
  readonly overlaysOn: boolean;
  /** Metrics HUD visible (`m`). */
  readonly metricsOn: boolean;
  readonly paused: boolean;
  readonly cadence: Cadence;
  readonly ruler: number;
};

/** Low-rate status for the chrome, written by ref at 2 Hz. */
export type RuntimeStatus = {
  readonly connection: ConnectionState;
  readonly mid: string;
  readonly coin: string;
  readonly groupLabel: string;
  /** Metrics HUD text; empty when metrics are off. */
  readonly hud: string;
  /** Grouping options for the current market, coarse to fine. */
  readonly groupOptions: ReadonlyArray<GroupOption>;
  /** Row step in raw ticks currently in use. */
  readonly gridTick: number;
};

/** Host inputs. */
export type RuntimeOptions = {
  readonly canvas: HTMLCanvasElement;
  readonly feed: FeedSource;
  readonly state: RuntimeState;
  readonly onStatus: (status: RuntimeStatus) => void;
};

/** The runtime handle. */
export type Runtime = {
  /** Adopt new widget state; cheap, diffs internally. */
  readonly update: (state: RuntimeState) => void;
  /** Pointer y in CSS px within the canvas, or `undefined` when the pointer left. */
  readonly setHover: (y: number | undefined) => void;
  /** Stop the loop, the feed and the observers. */
  readonly dispose: () => void;
};

const HOST_TICK_MS = 500;
const STATUS_MS = 500;
const FPS30_CAP_MS = 1000 / 30 - 1;
/** A resync dims the frozen ladder to this over this long, then the new grid fades in. */
const RESYNC_DIM = 0.35;
const RESYNC_FADE_MS = 400;

/**
 * Start a runtime on a canvas.
 *
 * @param options - Canvas, feed, initial state and status sink.
 * @returns The handle.
 */
export function createRuntime(options: RuntimeOptions): Runtime {
  const { canvas } = options;
  const ctx = canvas.getContext("2d", { desynchronized: true });
  if (ctx === null) throw new Error("2d canvas context unavailable");
  let state = options.state;
  let market: MarketInfo | undefined;
  let scale: PriceScale | undefined;
  let gridTick = 1;
  let groupLabel = "–";
  let groupOptions: ReadonlyArray<GroupOption> = [];
  let decade: number | undefined;
  const engine: Engine = createEngine({ gridTick, scale: undefined });
  const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  const reducedMotion = (): boolean => reducedMotionQuery.matches;
  const sampler: Sampler = createSampler(createLevelHistory({ reducedMotion }), createTape(), {
    reducedMotion,
  });
  let width = 0;
  let height = 0;
  let lastT = performance.now();
  let lastDraw = 0;
  let lastVersion = -1;
  let lastStatus = 0;
  const frames: number[] = [];
  let drawn = 0;
  let fpsSince = performance.now();
  let fps = 0;
  let resyncSince: number | undefined;
  let lastFrame: FrameSample | undefined;
  let raf = 0;
  let disposed = false;
  let hoverY: number | undefined;
  let hoverDirty = false;
  /** A toggle, view, ruler or resize change: a settled book still has to repaint. */
  let uiDirty = true;

  const resize = (): void => {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, Math.round(rect.width));
    height = Math.max(1, Math.round(rect.height));
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    lastVersion = -1;
    uiDirty = true;
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();

  const applyWantedGrid = (): void => {
    const wanted = state.gridTick;
    if (wanted === undefined || wanted === gridTick || market === undefined) return;
    const option = groupOptions.find((o) => o.gridTick === wanted);
    if (option !== undefined) options.feed.select(market.coin, option.precision);
  };

  const stopFeed = options.feed.start((event) => {
    if (disposed) return;
    if (event._tag === "market") {
      scale = event.market.scale;
      gridTick = Grouping.gridTickFor(event.market.mark, event.market.precision, scale);
      groupOptions = Grouping.deriveOptions(event.market.mark, scale);
      groupLabel = groupOptions.find((o) => o.gridTick === gridTick)?.label ?? "–";
      decade = Math.floor(Math.log10(event.market.mark));
      const sameCoin = market?.coin === event.market.coin;
      market = event.market;
      engine.reset({ gridTick, scale, keepTouch: sameCoin });
      sampler.reset(sameCoin ? "grid" : "coin");
      if (!sameCoin) lastFrame = undefined;
      applyWantedGrid();
      return;
    }
    // Pause freezes the picture, never the feed (spec, story 44): the book
    // stays current so resuming shows the market as it is now, not as it was.
    engine.apply(event);
  });
  const hostTick = setInterval(() => engine.apply({ _tag: "tick", rx: Date.now() }), HOST_TICK_MS);
  // Returning to a hidden tab: the next frame folds what queued, then settles rather than replaying minutes of motion.
  let snapPending = false;
  const onVisibility = (): void => {
    if (document.visibilityState !== "visible") return;
    snapPending = true;
    lastT = performance.now();
  };
  document.addEventListener("visibilitychange", onVisibility);

  /** The 2 Hz status line; shared so a paused widget still reports connection. */
  const emitStatus = (snapshot: BookSnapshot, S: FrameSample | undefined): void => {
    const sorted = [...frames].toSorted((a, b) => a - b);
    const at = (q: number): number => sorted[Math.floor(q * (sorted.length - 1))] ?? 0;
    options.onStatus({
      connection: snapshot.connection,
      mid: S === undefined || scale === undefined ? "–" : Tick.formatMid(S.mid, scale),
      coin: market?.coin ?? "–",
      groupLabel,
      groupOptions,
      gridTick,
      hud: state.metricsOn
        ? hudText({
            coin: market?.coin ?? "–",
            groupLabel,
            snapshot,
            metrics: S?.metrics,
            fps,
            frameP50: at(0.5),
            frameP95: at(0.95),
          })
        : "",
    });
  };

  /**
   * Ask the feed for the grouping the widget wants. A request made before the
   * market is known (a `g` URL param, say) is not lost: the option list only
   * exists once the market arrives, so this runs again then.
   */
  /**
   * Drain the engine into presentation state. Driven by a timer as well as by
   * paints: a hidden tab or an idle `on update` cadence still has to consume
   * what the socket produced, or the queues grow and the trail column gains a
   * hole for the time nobody sampled.
   */
  const ingest = (t: number): void => {
    if (scale === undefined) return;
    const settle = snapPending;
    snapPending = false;
    sampler.ingest(
      {
        snapshot: engine.snapshot(),
        events: engine.drain(),
        trades: engine.drainTrades(),
        migrations: engine.drainMigrations(),
        settle,
        // The HUD and the per-row overlays are independent controls, so the
        // metric source is needed when either is on: a narrow viewport that
        // collapses overlays must not blank a HUD the user asked for.
        ...(state.overlaysOn || state.metricsOn ? { engine } : {}),
      },
      t,
    );
  };
  const ingestTimer = setInterval(() => {
    if (!disposed && !state.paused) ingest(performance.now());
  }, TRAIL_DT);

  const frame = (): void => {
    if (disposed) return;
    raf = requestAnimationFrame(frame);
    const t = performance.now();
    const snapshot = engine.snapshot();
    const cap = state.cadence === "30" ? FPS30_CAP_MS : 0;
    if (state.paused) {
      // Hold the last painted frame: skip sampling and drawing, keep the clock
      // and the status line live so a disconnect is still visible while paused.
      lastT = t;
      snapPending = true;
      if (t - lastStatus > STATUS_MS) {
        lastStatus = t;
        emitStatus(snapshot, lastFrame);
      }
      return;
    }
    // Hover is not book state, so an `on update` cadence would otherwise hold the stale frame.
    if (
      state.cadence === "update" &&
      snapshot.version === lastVersion &&
      !sampler.moving() &&
      !hoverDirty &&
      !uiDirty
    ) {
      return;
    }
    hoverDirty = false;
    uiDirty = false;
    if (t - lastDraw < cap) return;
    // v4 measures dt per rAF; here it spans skipped frames so springs advance in real time at 30 fps.
    const dt = Math.min(0.05, (t - lastT) / 1000);
    lastT = t;
    lastDraw = t;
    lastVersion = snapshot.version;
    ctx.fillStyle = PALETTE.bg;
    ctx.fillRect(0, 0, width, height);
    // v4 re-derives the grid when the mid changes decade: the same precision means a coarser step.
    const midTicks = midOf(snapshot);
    if (midTicks !== undefined && scale !== undefined && market !== undefined) {
      const mid = midTicks * 10 ** -scale.decimals;
      const nextDecade = Math.floor(Math.log10(mid));
      if (nextDecade !== decade) {
        decade = nextDecade;
        groupOptions = Grouping.deriveOptions(mid, scale);
        gridTick = Grouping.gridTickFor(mid, market.precision, scale);
        groupLabel = groupOptions.find((o) => o.gridTick === gridTick)?.label ?? "–";
        engine.reset({ gridTick, scale, keepTouch: true });
        sampler.reset("grid");
      }
    }
    // Grouping change: the old ladder freezes and dims, then the first post-ack
    // frame fades in, so rows from two grids are never mixed (spec, story 37).
    const resyncing = snapshot.connection === "RESYNCING";
    if (resyncing) resyncSince = resyncSince ?? t;
    else if (resyncSince !== undefined && snapshot.bids.length > 0) resyncSince = undefined;
    ingest(t);
    const fresh = scale === undefined ? undefined : sampler.project({ height, gridTick, ruler: state.ruler }, t, dt);
    // While resyncing, keep painting the frozen frame dimmed rather than an empty ladder.
    const S = resyncing ? (fresh ?? lastFrame) : fresh;
    const fade = resyncSince === undefined ? 1 : Math.max(RESYNC_DIM, 1 - (t - resyncSince) / RESYNC_FADE_MS);
    ctx.globalAlpha = resyncing ? fade : 1;
    if (S !== undefined && scale !== undefined) {
      lastFrame = S;
      const draw = {
        ctx,
        width,
        height,
        scale,
        gridTick,
        // The spine reads narrow: no trails, no tape, so it also reclaims their columns.
        trailsOn: state.trailsOn && state.view === "ladder",
        tapeOn: state.tapeOn && state.view === "ladder",
        overlaysOn: state.overlaysOn,
        ...(hoverY === undefined ? {} : { hoverY }),
      };
      // The spine is the narrow reading: no trails, no tape (spec, story 7).
      if (state.view === "spine") drawSpine(draw, S);
      else drawLadder(draw, S);
      if (draw.tapeOn) drawTape(draw, S);
    }
    ctx.globalAlpha = 1;
    const frameMs = performance.now() - t;
    frames.push(frameMs);
    if (frames.length > 120) frames.shift();
    drawn++;
    if (t - lastStatus > STATUS_MS) {
      fps = drawn / ((t - fpsSince) / 1000);
      drawn = 0;
      fpsSince = t;
      lastStatus = t;
      emitStatus(snapshot, S);
    }
  };
  raf = requestAnimationFrame(frame);

  return {
    update: (next) => {
      state = next;
      uiDirty = true;
      applyWantedGrid();
    },
    setHover: (y) => {
      if (y === hoverY) return;
      hoverY = y;
      hoverDirty = true;
    },
    dispose: () => {
      disposed = true;
      cancelAnimationFrame(raf);
      clearInterval(hostTick);
      clearInterval(ingestTimer);
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      stopFeed();
    },
  };
}

/** Mid in quote units from the fused touch, or `undefined` before both sides exist. */
function midOf(snapshot: BookSnapshot): number | undefined {
  const b = snapshot.bestBid ?? snapshot.bids[0];
  const a = snapshot.bestAsk ?? snapshot.asks[0];
  return b === undefined || a === undefined ? undefined : (b.px + a.px) / 2;
}
