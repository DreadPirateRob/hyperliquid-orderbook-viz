import type { BookSnapshot } from "../data/engine-api.types";
import type { Level } from "../data/feed-events.types";
import type { Tick } from "../domain/tick";
import type { FrameRow, FrameSample } from "./frame-sample.types";
import { Spring } from "./spring";

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

/** The state layer's sampler. */
export type Sampler = {
  /** Produce a frame, or nothing until both sides have a best. */
  readonly sample: (snapshot: BookSnapshot, geometry: SampleGeometry, t: number, dt: number) => FrameSample | undefined;
  /** Forget the anchor (coin/grouping change). */
  readonly reset: () => void;
  /** True while anything is still animating. */
  readonly moving: () => boolean;
};

/**
 * Create a sampler with an unset anchor.
 *
 * @returns A sampler.
 */
export function createSampler(): Sampler {
  const anchor = new Spring(0, ANCHOR_K, ANCHOR_C);
  let anchorSet = false;
  return {
    sample: (snapshot, geometry, t, dt) => {
      const gb = snapshot.bids[0];
      const ga = snapshot.asks[0];
      if (gb === undefined || ga === undefined) return undefined;
      const bb = snapshot.bestBid ?? gb;
      const aa = snapshot.bestAsk ?? ga;
      const b = bb.px;
      const a = aa.px;
      const mid = (b + a) / 2;
      if (!anchorSet) {
        anchor.snap(mid);
        anchorSet = true;
      }
      const rows = Math.floor(geometry.height / ROW);
      const half = Math.floor(rows / 2);
      const grid = geometry.gridTick;
      if (Math.abs(mid - anchor.target) > grid * half * RECENTRE_FRACTION) anchor.target = mid;
      const centre = anchor.step(dt);
      const top = Math.round(centre / grid) * grid + half * grid;
      const out = layRows(rows, top, grid, b, a, snapshot, t);
      const midIdx = out.findIndex((r) => r.px < mid);
      const ribY = midIdx === -1 ? rows * ROW : midIdx * ROW;
      accumulate(out, midIdx, geometry.ruler);
      let maxSz = 0;
      let maxCum = 0;
      for (const r of out) {
        if (!r.inRuler) continue;
        if (r.shown > maxSz) maxSz = r.shown;
        if (r.cum > maxCum) maxCum = r.cum;
      }
      const share = bb.sz + aa.sz > 0 ? bb.sz / (bb.sz + aa.sz) : 0.5;
      const lo = out[Math.max(0, midIdx - geometry.ruler)];
      const hi = out[Math.min(out.length - 1, midIdx + geometry.ruler - 1)];
      return {
        t,
        rows: out,
        maxSz: maxSz || 1,
        maxCum: maxCum || 1,
        maxField: 1,
        ribY,
        rulerY: [lo?.y ?? 0, (hi?.y ?? rows * ROW) + ROW],
        midIdx,
        mid,
        micro: b + share * (a - b),
        share,
        bestBid: b,
        bestAsk: a,
      };
    },
    reset: () => {
      anchorSet = false;
    },
    moving: () => anchor.moving,
  };
}

type MutableRow = { -readonly [K in keyof FrameRow]: FrameRow[K] };

function layRows(count: number, top: number, grid: number, b: Tick, a: Tick, snapshot: BookSnapshot, t: number): MutableRow[] {
  const bids = indexByPx(snapshot.bids);
  const asks = indexByPx(snapshot.asks);
  const out: MutableRow[] = [];
  for (let i = 0; i < count; i++) {
    // SAFETY: `top` and `grid` are integers derived from ticks, so the row price is an integer tick.
    const px = (top - i * grid) as Tick;
    const side = px >= a ? "ask" : px <= b ? "bid" : "spread";
    const level = side === "ask" ? asks.get(px) : side === "bid" ? bids.get(px) : undefined;
    const live = level?.sz ?? 0;
    out.push({ i, y: i * ROW, px, side, shown: live, live, cum: 0, inRuler: false, field: 0, pulses: EMPTY, first: t });
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
