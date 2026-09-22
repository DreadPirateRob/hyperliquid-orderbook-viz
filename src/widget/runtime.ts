import type { Engine } from "../data/engine-api.types";
import { createEngine } from "../data/engine";
import type { FeedSource, MarketInfo } from "../data/feed-events.types";
import * as Grouping from "../domain/grouping";
import type { PriceScale } from "../domain/tick";
import * as Tick from "../domain/tick";
import { drawLadder } from "../render/ladder";
import { PALETTE } from "../render/palette";
import { createLevelHistory } from "../state/level-history";
import type { Sampler } from "../state/sampler";
import { createSampler } from "../state/sampler";
import type { ConnectionState } from "../data/engine-api.types";

/**
 * The imperative shell behind `<OrderBook>` (ADR 0008): owns the engine,
 * sampler, canvas, frame loop, host ticks and the feed subscription. React
 * hands it a canvas and a state object; it never re-renders for frames.
 */

/** Frame cadence (v4's `fpsMode`). */
export type Cadence = "60" | "30" | "update";

/** What the runtime reads from widget state each frame. */
export type RuntimeState = {
  readonly trailsOn: boolean;
  readonly tapeOn: boolean;
  readonly overlaysOn: boolean;
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
  /** Stop the loop, the feed and the observers. */
  readonly dispose: () => void;
};

const HOST_TICK_MS = 500;
const STATUS_MS = 500;
const FPS30_CAP_MS = 1000 / 30 - 1;

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
  const engine: Engine = createEngine({ gridTick });
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const sampler: Sampler = createSampler(createLevelHistory({ reducedMotion }));
  let width = 0;
  let height = 0;
  let lastT = performance.now();
  let lastDraw = 0;
  let lastVersion = -1;
  let lastStatus = 0;
  let raf = 0;
  let disposed = false;

  const resize = (): void => {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, Math.round(rect.width));
    height = Math.max(1, Math.round(rect.height));
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    lastVersion = -1;
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();

  const stopFeed = options.feed.start((event) => {
    if (disposed) return;
    if (event._tag === "market") {
      market = event.market;
      scale = event.market.scale;
      gridTick = Grouping.gridTickFor(event.market.mark, event.market.precision, scale);
      groupLabel = Grouping.deriveOptions(event.market.mark, scale).find((o) => o.gridTick === gridTick)?.label ?? "–";
      engine.reset({ gridTick });
      sampler.reset();
      return;
    }
    if (state.paused && event._tag !== "connection" && event._tag !== "tick") return;
    engine.apply(event);
  });
  const hostTick = setInterval(() => engine.apply({ _tag: "tick", rx: Date.now() }), HOST_TICK_MS);
  // Returning to a hidden tab: fold what queued, then settle rather than replay minutes of motion.
  const onVisibility = (): void => {
    if (document.visibilityState !== "visible") return;
    sampler.snap();
    lastT = performance.now();
  };
  document.addEventListener("visibilitychange", onVisibility);

  const frame = (): void => {
    if (disposed) return;
    raf = requestAnimationFrame(frame);
    const t = performance.now();
    const snapshot = engine.snapshot();
    const cap = state.cadence === "30" ? FPS30_CAP_MS : 0;
    if (state.cadence === "update" && snapshot.version === lastVersion && !sampler.moving()) return;
    if (t - lastDraw < cap) return;
    // v4 measures dt per rAF; here it spans skipped frames so springs advance in real time at 30 fps.
    const dt = Math.min(0.05, (t - lastT) / 1000);
    lastT = t;
    lastDraw = t;
    lastVersion = snapshot.version;
    ctx.fillStyle = PALETTE.bg;
    ctx.fillRect(0, 0, width, height);
    const events = engine.drain();
    const trades = engine.drainTrades();
    const S = scale === undefined ? undefined : sampler.sample({ snapshot, events, trades }, { height, gridTick, ruler: state.ruler }, t, dt);
    if (S !== undefined && scale !== undefined) {
      drawLadder({ ctx, width, height, scale, gridTick, trailsOn: state.trailsOn, tapeOn: state.tapeOn, overlaysOn: state.overlaysOn }, S);
    }
    if (t - lastStatus > STATUS_MS) {
      lastStatus = t;
      options.onStatus({
        connection: snapshot.connection,
        mid: S === undefined || scale === undefined ? "–" : formatMid(S.mid, scale),
        coin: market?.coin ?? "–",
        groupLabel,
      });
    }
  };
  raf = requestAnimationFrame(frame);

  return {
    update: (next) => {
      state = next;
    },
    dispose: () => {
      disposed = true;
      cancelAnimationFrame(raf);
      clearInterval(hostTick);
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      stopFeed();
    },
  };
}

/** v4 `fmtMid`: one extra decimal when the mid sits between ticks. */
function formatMid(mid: number, scale: PriceScale): string {
  const whole = Math.round(mid);
  const r = Tick.fromInteger(whole);
  if (r._tag === "err") return "–";
  const base = Tick.format(r.value, scale);
  if (Math.abs(mid - whole) < 1e-9) return base;
  const halfDigit = Math.round((mid - Math.floor(mid)) * 10);
  const low = Tick.fromInteger(Math.floor(mid));
  if (low._tag === "err") return base;
  const lowText = Tick.format(low.value, scale);
  return `${lowText}${lowText.includes(".") ? "" : "."}${halfDigit}`;
}
