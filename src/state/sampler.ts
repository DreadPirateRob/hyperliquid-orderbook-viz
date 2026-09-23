import type { BookSnapshot, LevelEvent, LevelWatch, Metrics, Migration } from "../data/engine-api.types";
import type { Level, Side, Trade } from "../data/feed-events.types";
import type { Tick } from "../domain/tick";
import type { FrameRow, FrameSample, MidSample } from "./frame-sample.types";
import type { LevelHistory } from "./level-history";
import { Spring } from "./spring";
import type { Tape } from "./tape";
import { TRAIL_DT, TRAIL_MS, pruneBefore } from "./trail";

/**
 * The sampler turns an engine snapshot into one frame sample (v4's
 * `sample(dt)`): it owns the anchor spring, lays rows on the grid around it,
 * classifies sides from the true best (BBO), accumulates depth from the
 * touch outward and normalises inside the ruler band.
 */

/** Row height in CSS px (v4). */
export const ROW = 22;

/** Anchor spring constants and re-centre hysteresis (v4). */
const ANCHOR_K = 40;
const ANCHOR_C = 13;
const RECENTRE_FRACTION = 0.3;

/** What the sampler needs from the host each frame. */
export type SampleGeometry = {
  /** Canvas height in CSS px. */
  readonly height: number;
  /** Row step in raw ticks. */
  readonly gridTick: number;
  /** Rows either side of the touch inside the ruler. */
  readonly ruler: number;
};

/** What changed since the last frame, drained from the engine. */
export type FrameInput = {
  readonly snapshot: BookSnapshot;
  readonly events: ReadonlyArray<LevelEvent>;
  readonly trades: ReadonlyArray<Trade>;
  /** Repricing pairs drained this frame. */
  readonly migrations?: ReadonlyArray<Migration>;
  /** Metric reader; omitted when overlays are off, so nothing is computed. */
  readonly engine?: MetricSource;
  /** Fold the changes, then settle every spring and drop pulses before laying rows (tab return). */
  readonly settle: boolean;
};

/** What the sampler pulls from the engine for overlays. */
export type MetricSource = {
  readonly field: (side: Side, px: Tick) => number;
  readonly watch: (side: Side, px: Tick) => LevelWatch | undefined;
  readonly metrics: () => Metrics;
};

/** Sampler options. */
export type SamplerOptions = {
  /** OS reduced-motion preference, read per frame: the anchor snaps instead of gliding. */
  readonly reducedMotion: () => boolean;
};

/** The state layer's sampler. */
export type Sampler = {
  /** Fold the frame's changes into the history and produce a frame, or nothing until both sides have a best. */
  readonly sample: (input: FrameInput, geometry: SampleGeometry, t: number, dt: number) => FrameSample | undefined;
  /**
   * Forget the ladder. `"grid"` (grouping/precision change) keeps the tape and
   * touch trail, as v4's `resetLadder` does; `"coin"` forgets everything.
   */
  readonly reset: (scope: "coin" | "grid") => void;
  /** True while anything is still animating. */
  readonly moving: () => boolean;
};

/**
 * Create a sampler with an unset anchor.
 *
 * @param history - The per-level animation store the sampler drives.
 * @param tape - The trades tape the sampler feeds.
 * @param options - Motion preferences.
 * @returns A sampler.
 */
export function createSampler(history: LevelHistory, tape: Tape, options: SamplerOptions): Sampler {
  const anchor = new Spring(0, ANCHOR_K, ANCHOR_C);
  let anchorSet = false;
  let lastTrail = -Infinity;
  const live: Migration[] = [];
  const midTrail: MidSample[] = [];
  let lastTrade: FrameSample["lastTrade"];
  return {
    sample: ({ snapshot, events, trades, settle, migrations, engine }, geometry, t, dt) => {
      if (migrations !== undefined && migrations.length > 0) live.push(...migrations);
      pruneMigrations(live, t);
      history.applyLevelEvents(events, t);
      history.applyTrades(trades, t);
      tape.apply(trades, t);
      for (const tr of trades) {
        const dir =
          lastTrade === undefined || tr.px === lastTrade.px ? (lastTrade?.dir ?? 0) : tr.px > lastTrade.px ? 1 : -1;
        lastTrade = { px: tr.px, dir };
      }
      history.step(t, dt);
      if (settle) {
        history.snap();
        anchor.snap(anchor.target);
      }
      const gb = snapshot.bids[0];
      const ga = snapshot.asks[0];
      if (gb === undefined || ga === undefined) return undefined;
      const bb = snapshot.bestBid ?? gb;
      const aa = snapshot.bestAsk ?? ga;
      const b = bb.px;
      const a = aa.px;
      const mid = (b + a) / 2;
      if (t - lastTrail > TRAIL_DT) {
        lastTrail = t;
        history.sampleTrails(t);
        midTrail.push({ t, b, a, share: bb.sz + aa.sz > 0 ? bb.sz / (bb.sz + aa.sz) : 0.5 });
        pruneBefore(midTrail, t - TRAIL_MS);
      }
      if (!anchorSet) {
        anchor.snap(mid);
        anchorSet = true;
      }
      const rows = Math.floor(geometry.height / ROW);
      const half = Math.floor(rows / 2);
      const grid = geometry.gridTick;
      if (Math.abs(mid - anchor.target) > grid * half * RECENTRE_FRACTION) {
        if (options.reducedMotion()) anchor.snap(mid);
        else anchor.target = mid;
      }
      const centre = anchor.step(dt);
      // Rows below zero are impossible prices; the top row is at least (rows − 1) grid steps so no row goes negative.
      const top = Math.max((rows - 1) * grid, Math.round(centre / grid) * grid + half * grid);
      const out = layRows(rows, top, grid, b, a, snapshot, history, t, engine);
      const midIdx = out.findIndex((r) => r.px < mid);
      const ribY = midIdx === -1 ? rows * ROW : midIdx * ROW;
      accumulate(out, midIdx, geometry.ruler);
      let maxSz = 0;
      let maxCum = 0;
      let maxField = 0;
      for (const r of out) {
        if (!r.inRuler) continue;
        if (r.shown > maxSz) maxSz = r.shown;
        if (r.cum > maxCum) maxCum = r.cum;
        if (Math.abs(r.field) > maxField) maxField = Math.abs(r.field);
      }
      const share = bb.sz + aa.sz > 0 ? bb.sz / (bb.sz + aa.sz) : 0.5;
      const lo = out[Math.max(0, midIdx - geometry.ruler)];
      const hi = out[Math.min(out.length - 1, midIdx + geometry.ruler - 1)];
      return {
        t,
        rows: out,
        maxSz: maxSz || 1,
        maxCum: maxCum || 1,
        maxField: maxField || 1,
        ribY,
        rulerY: [lo?.y ?? 0, (hi?.y ?? rows * ROW) + ROW],
        midIdx,
        mid,
        micro: b + share * (a - b),
        share,
        bestBid: b,
        bestAsk: a,
        rawTouch: snapshot.bestBid !== undefined && snapshot.bestAsk !== undefined,
        bestBidSz: bb.sz,
        bestAskSz: aa.sz,
        midTrail,
        migrations: live,
        metrics: engine?.metrics(),
        tape: tape.rows(),
        tapeOutlier: tape.outlierSize(t),
        lastTrade,
      };
    },
    reset: (scope) => {
      anchorSet = false;
      history.clear();
      lastTrail = -Infinity;
      if (scope === "coin") {
        tape.clear();
        midTrail.length = 0;
        live.length = 0;
        lastTrade = undefined;
      }
    },
    moving: () => anchor.moving || history.moving(),
  };
}

type MutableRow = { -readonly [K in keyof FrameRow]: FrameRow[K] };

function layRows(
  count: number,
  top: number,
  grid: number,
  b: Tick,
  a: Tick,
  snapshot: BookSnapshot,
  history: LevelHistory,
  t: number,
  engine: MetricSource | undefined,
): MutableRow[] {
  const bids = indexByPx(snapshot.bids);
  const asks = indexByPx(snapshot.asks);
  const out: MutableRow[] = [];
  for (let i = 0; i < count; i++) {
    // SAFETY: `top` and `grid` are integers derived from ticks and `top ≥ (count − 1)·grid`, so every row price is a non-negative integer tick.
    const px = (top - i * grid) as Tick;
    const side = px >= a ? "ask" : px <= b ? "bid" : "spread";
    const level = side === "ask" ? asks.get(px) : side === "bid" ? bids.get(px) : undefined;
    const live = level?.sz ?? 0;
    const h = side === "spread" ? undefined : history.get(side, px);
    out.push({
      i,
      y: i * ROW,
      px,
      side,
      shown: h?.shown ?? live,
      live,
      prev: h?.prev ?? live,
      cum: 0,
      inRuler: false,
      field: side === "spread" || engine === undefined ? 0 : engine.field(side, px),
      watch: side === "spread" || engine === undefined ? undefined : engine.watch(side, px),
      pulses: h?.pulses ?? EMPTY,
      first: h?.first ?? t,
      trail: h?.trail ?? EMPTY,
    });
  }
  return out;
}

const EMPTY: ReadonlyArray<never> = [];

function indexByPx(levels: ReadonlyArray<Level>): Map<number, Level> {
  const m = new Map<number, Level>();
  for (const l of levels) m.set(l.px, l);
  return m;
}

/** v4: bids accumulate downward from the touch, asks upward; every side row carries the running total. */
function accumulate(rows: MutableRow[], midIdx: number, ruler: number): void {
  let cumB = 0;
  let cumA = 0;
  for (const r of rows) {
    r.inRuler = Math.abs(r.i - (midIdx - 0.5)) <= ruler;
    if (r.side === "bid") {
      cumB += r.shown;
      r.cum = cumB;
    }
  }
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (r === undefined || r.side !== "ask") continue;
    cumA += r.shown;
    r.cum = cumA;
  }
}

/** Migration connectors fade over 600 ms and are dropped at 1.5 s (v4). */
function pruneMigrations(list: Migration[], t: number): void {
  let drop = 0;
  while (drop < list.length && t - (list[drop]?.t ?? t) > 1500) drop++;
  if (drop > 0) list.splice(0, drop);
}
