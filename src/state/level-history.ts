import type { LevelEvent } from "../data/engine-api.types";
import type { Side, Trade } from "../data/feed-events.types";
import type { Tick } from "../domain/tick";
import { casesHandled } from "../shared/result";
import type { Pulse, TrailSample } from "./frame-sample.types";
import { PERSISTENCE_MS, SAT_FLOOR, TRAIL_MS, pruneBefore } from "./trail";
import { Spring } from "./spring";

/**
 * v4's `hist`: per-price animation state, keyed by side and tick. It lives
 * in the state layer (ADR 0003): the engine reports what changed, this
 * store decides how it moves. Time is the frame clock passed in by the
 * sampler, never read here.
 */

/** v4 spring constants for level sizes. */
const SIZE_K = 180;
const SIZE_C = 24;
/** Pulses older than this are pruned; at most this many per level. */
const PULSE_TTL_MS = 1500;
const PULSE_CAP = 6;
/** A level at zero with nothing playing is forgotten after this long. */
const DEAD_MS = 60_000;

/** One level's animation state as seen by the sampler. */
export type LevelState = {
  readonly side: Side;
  readonly px: Tick;
  /** Frame time the level was first (or again) seen with size. */
  readonly first: number;
  readonly lastChanged: number;
  /** Size the engine last reported. */
  readonly live: number;
  /** Size before the last change (ghost width = prev − live). */
  readonly prev: number;
  /** Spring-eased size. */
  readonly shown: number;
  readonly pulses: ReadonlyArray<Pulse>;
};

/** Options fixed at construction. */
export type LevelHistoryOptions = {
  /** OS reduced-motion preference, read at each change: springs snap, pulses are not recorded. */
  readonly reducedMotion: () => boolean;
};

/** The store. */
export type LevelHistory = {
  /** Fold engine level events at frame time `t`. */
  readonly applyLevelEvents: (events: ReadonlyArray<LevelEvent>, t: number) => void;
  /** Fire fill pulses for live prints at frame time `t`. */
  readonly applyTrades: (trades: ReadonlyArray<Trade>, t: number) => void;
  /** Advance springs, prune pulses and dead levels. */
  readonly step: (t: number, dt: number) => void;
  /**
   * Append one trail sample per level and drop samples outside the window
   * (called every `TRAIL_DT`).
   *
   * @param t - Frame time.
   * @param maxSz - Largest level size in the ruler as of the last projected frame; the shading denominator.
   * @param gridTick - Row step in force now, stamped on every sample taken.
   */
  readonly sampleTrails: (t: number, maxSz: number, gridTick: number) => void;
  /**
   * Carry history across a grouping change instead of forgetting it.
   *
   * An instant belongs to exactly one grid, so samples taken under the old
   * grouping never overlap in time with samples taken under the new one and
   * can never be double-counted. What can be done with them depends on the
   * direction:
   *
   * - **Coarser, by a whole multiple** — the old trails are merged into the
   *   new buckets exactly. Every price's sample at one instant shares a
   *   timestamp, so summing per timestamp reproduces the trail the coarse
   *   grouping would have recorded. Sizes are exact; `rel` keeps the
   *   denominator in force when it was sampled, per the freeze rule in ADR
   *   0009, and is clamped at 1.
   * - **Finer, or not a whole multiple** — the sub-buckets never existed. The
   *   old samples are kept as *bands* covering the rows they span, and are
   *   never split across them, because nothing says how the depth was
   *   distributed inside the bucket.
   *
   * Live per-side state (springs, pulses, ghost widths) describes resting
   * orders on the old grid and is dropped.
   *
   * @param from - Row step the existing samples were taken at.
   * @param to - Row step from now on.
   */
  readonly regrid: (from: number, to: number) => void;
  /** Look up one level's state. */
  readonly get: (side: Side, px: Tick) => LevelState | undefined;
  /**
   * Look up a price's trail.
   *
   * Trails are keyed by price alone, not by `(side, price)`. A sweep flips
   * which side a price is on, and the row's side is recomputed from the live
   * touch every frame: keying the history by side meant a swept price looked up
   * a key nothing had ever written, and its painted history vanished although
   * the samples were still held under the other side. A price inside the spread
   * has no side at all and lost its history for the same reason.
   *
   * @param px - The price.
   * @returns Its samples, oldest first; empty when nothing was ever recorded.
   */
  readonly trailAt: (px: Tick) => ReadonlyArray<TrailSample>;
  /**
   * Look up the coarser-grid history covering a price, left by the last
   * grouping change.
   *
   * @param px - The row price.
   * @returns Samples covering it, oldest first; empty when the window holds no coarser history.
   */
  readonly bandAt: (px: Tick) => ReadonlyArray<TrailSample>;
  /** True while any spring or pulse is live. */
  readonly moving: () => boolean;
  /** Settle every spring and drop pulses (tab return, reduced motion). */
  readonly snap: () => void;
  /** Forget everything, including bands (coin change). */
  readonly clear: () => void;
};

function key(side: Side, px: Tick): string {
  return `${side}:${px}`;
}

/** Shared empty result: a price with no history must not allocate one per frame. */
const EMPTY_TRAIL: ReadonlyArray<TrailSample> = [];

/** Which of two entries at one price speaks for it: the live one, else the more recently changed. */
function better(a: Entry, b: Entry): boolean {
  if (a.live > 0 !== b.live > 0) return a.live > 0;
  return a.lastChanged > b.lastChanged;
}

type Entry = {
  readonly side: Side;
  readonly px: Tick;
  first: number;
  lastChanged: number;
  live: number;
  prev: number;
  readonly spring: Spring;
  pulses: Pulse[];
};

/** The bucket a price falls in on a grid: bids round down, asks round up, as both venues aggregate. */
function bucketOf(px: number, side: Side, grid: number): number {
  return (side === "bid" ? Math.floor(px / grid) : Math.ceil(px / grid)) * grid;
}

/** One bucket's running total at one instant while merging a finer grid into a coarser one. */
type Merge = {
  sz: number;
  /** Shading denominator in force when the samples were taken, recovered from `sz / rel`. */
  scale: number;
  /** Size of the largest contributor, which speaks for the bucket's side and persistence. */
  top: number;
  sat: number;
  side: Side;
};

/**
 * Merge every trail into the buckets of a coarser grid, in place.
 *
 * Exact in size: all of a price's samples at one instant share a timestamp,
 * so summing per timestamp is precisely what the coarser grouping would have
 * recorded. Not exact in shading — the ruler's largest level under the coarse
 * grouping was never observed — so `rel` keeps the denominator in force when
 * the samples were taken, which is the freeze rule of ADR 0009, and saturates
 * at 1 where a summed bucket outgrows the largest level of its own time.
 *
 * @param trails - Trails keyed by price; replaced by the merged result.
 * @param to - The coarser row step, a whole multiple of the current one.
 */
function mergeInto(trails: Map<number, TrailSample[]>, to: number): void {
  const buckets = new Map<number, Map<number, Merge>>();
  for (const [px, trail] of trails) {
    for (const s of trail) {
      const bucket = bucketOf(px, s.side, to);
      let byTime = buckets.get(bucket);
      if (byTime === undefined) {
        byTime = new Map<number, Merge>();
        buckets.set(bucket, byTime);
      }
      const acc = byTime.get(s.t);
      const scale = s.rel > 0 ? s.sz / s.rel : 0;
      if (acc === undefined) byTime.set(s.t, { sz: s.sz, scale, top: s.sz, sat: s.sat, side: s.side });
      else {
        acc.sz += s.sz;
        if (scale > acc.scale) acc.scale = scale;
        if (s.sz > acc.top) {
          acc.top = s.sz;
          acc.sat = s.sat;
          acc.side = s.side;
        }
      }
    }
  }
  trails.clear();
  for (const [bucket, byTime] of buckets) {
    const out: TrailSample[] = [];
    for (const [t, m] of byTime) {
      out.push({ t, sz: m.sz, rel: m.scale > 0 ? Math.min(1, m.sz / m.scale) : 0, sat: m.sat, side: m.side, g: to });
    }
    out.sort((a, b) => a.t - b.t);
    trails.set(bucket, out);
  }
}

/**
 * One bucket of coarser history set aside by a grouping change.
 *
 * The two sides are stored apart because their buckets cover different prices
 * — bids round down, asks up — and because it makes covering a row pure
 * arithmetic: no sample is examined to decide whether a band applies.
 */
type Band = {
  readonly bucket: number;
  /** Row step the samples were taken at. */
  readonly g: number;
  /** Covers `[bucket, bucket + g)`. */
  readonly bid: TrailSample[];
  /** Covers `(bucket - g, bucket]`. */
  readonly ask: TrailSample[];
};

/** The samples of `band` that cover a row price: one side, both, or neither. */
function coveringSide(band: Band, px: number): TrailSample[] | undefined {
  const bid = band.bid.length > 0 && px >= band.bucket && px < band.bucket + band.g;
  const ask = band.ask.length > 0 && px <= band.bucket && px > band.bucket - band.g;
  if (bid && ask) return undefined;
  if (bid) return band.bid;
  if (ask) return band.ask;
  return undefined;
}

/** Whether a band covers a row price on either side. */
function bandCovers(band: Band, px: number): boolean {
  const bid = band.bid.length > 0 && px >= band.bucket && px < band.bucket + band.g;
  const ask = band.ask.length > 0 && px <= band.bucket && px > band.bucket - band.g;
  return bid || ask;
}

/**
 * Create an empty history.
 *
 * @param options - Motion preferences.
 * @returns The store.
 */
export function createLevelHistory(options: LevelHistoryOptions): LevelHistory {
  const entries = new Map<string, Entry>();
  /** Trail samples per price, independent of which side that price is on now. */
  const trails = new Map<number, TrailSample[]>();
  /** Coarser-grid history left by a grouping change, keyed by `bucket:step`. */
  const bands = new Map<string, Band>();
  /**
   * Row lookups into `bands`, built on demand and dropped whenever bands
   * change. Keyed by the set of bands covering the row, not by the row price,
   * so every row a band spans is handed back the *same* array: the renderer
   * relies on that identity to draw a band once, as one block, rather than
   * repainting it on each row it covers.
   */
  const bandRows = new Map<string, ReadonlyArray<TrailSample>>();
  /** Row price to its cover key, so a repeat lookup never re-derives the key. */
  const bandKeys = new Map<number, string>();
  const rec = (side: Side, px: Tick, t: number): Entry => {
    const k = key(side, px);
    let e = entries.get(k);
    if (e === undefined) {
      e = {
        side,
        px,
        first: t,
        lastChanged: t,
        live: 0,
        prev: 0,
        spring: new Spring(0, SIZE_K, SIZE_C),
        pulses: [],
      };
      entries.set(k, e);
    }
    return e;
  };
  const pulse = (e: Entry, kind: Pulse["kind"], t: number): void => {
    if (options.reducedMotion()) return;
    e.pulses.push({ kind, t0: t });
    if (e.pulses.length > PULSE_CAP) e.pulses.shift();
  };
  const setSize = (e: Entry, size: number, t: number): void => {
    e.live = size;
    e.lastChanged = t;
    if (options.reducedMotion()) e.spring.snap(size);
    else e.spring.target = size;
  };
  const view = (e: Entry): LevelState => ({
    side: e.side,
    px: e.px,
    first: e.first,
    lastChanged: e.lastChanged,
    live: e.live,
    prev: e.prev,
    shown: e.spring.x,
    pulses: e.pulses,
  });

  return {
    applyLevelEvents: (events, t) => {
      for (const ev of events) {
        const e = rec(ev.side, ev.px, t);
        switch (ev.kind) {
          case "added":
            // v4 leaves `prev` alone on add so a ghost from a vanish keeps its width if the level returns mid-fade.
            if (e.live === 0 && e.spring.x < 1e-9) e.first = t;
            setSize(e, ev.to, t);
            pulse(e, "add", t);
            break;
          case "grew":
            e.prev = e.live;
            setSize(e, ev.to, t);
            pulse(e, "grew", t);
            break;
          case "shrank":
          case "vanished":
            e.prev = e.live;
            setSize(e, ev.to, t);
            pulse(e, ev.consumed > 0 ? "consumed" : "ghost", t);
            break;
          case "outOfWindow":
            e.prev = e.live;
            setSize(e, 0, t);
            break;
          case "migrated":
            break;
          default:
            casesHandled(ev.kind);
        }
      }
    },
    applyTrades: (trades, t) => {
      for (const tr of trades) pulse(rec(tr.side === "B" ? "ask" : "bid", tr.px, t), "fill", t);
    },
    step: (t, dt) => {
      for (const [k, e] of entries) {
        e.spring.step(dt);
        if (e.pulses.length > 0) e.pulses = e.pulses.filter((p) => t - p.t0 < PULSE_TTL_MS);
        if (e.live === 0 && t - e.lastChanged > DEAD_MS && e.pulses.length === 0) entries.delete(k);
      }
    },
    sampleTrails: (t, maxSz, gridTick) => {
      // Shading is decided here, once, against the scale in force at this
      // instant, and stays with the sample for the rest of its life in the window.
      let scale = maxSz;
      if (scale <= 0) for (const e of entries.values()) if (e.live > scale) scale = e.live;
      // One sample per price. A price has at most one live side; when both
      // sides carry an entry (the level just flipped, and the old side is a
      // zero awaiting its 60 s eviction) the live one is the truth, and the
      // more recently changed one breaks the tie.
      for (const e of entries.values()) {
        const other = entries.get(key(e.side === "bid" ? "ask" : "bid", e.px));
        if (other !== undefined && better(other, e)) continue;
        let trail = trails.get(e.px);
        if (trail === undefined) {
          trail = [];
          trails.set(e.px, trail);
        }
        trail.push({
          t,
          sz: e.live,
          rel: scale > 0 ? e.live / scale : 0,
          sat: SAT_FLOOR + (1 - SAT_FLOOR) * Math.min(1, (t - e.first) / PERSISTENCE_MS),
          side: e.side,
          g: gridTick,
        });
      }
      for (const [px, trail] of trails) {
        pruneBefore(trail, t - TRAIL_MS);
        if (trail.length === 0) trails.delete(px);
      }
      if (bands.size === 0) return;
      // Bands never gain samples, so they only ever shrink out of the window.
      let dropped = false;
      for (const [k, band] of bands) {
        const before = band.bid.length + band.ask.length;
        pruneBefore(band.bid, t - TRAIL_MS);
        pruneBefore(band.ask, t - TRAIL_MS);
        if (band.bid.length + band.ask.length !== before) dropped = true;
        if (band.bid.length === 0 && band.ask.length === 0) bands.delete(k);
      }
      if (dropped) {
        bandRows.clear();
        bandKeys.clear();
      }
    },
    regrid: (from, to) => {
      // Live state — springs, pulses, ghost widths — describes resting orders
      // on the old grid, and none of it survives the change.
      entries.clear();
      if (from === to || from <= 0 || to <= 0) return;
      if (to > from && to % from === 0) {
        mergeInto(trails, to);
        return;
      }
      // Nothing recorded how depth was spread inside a bucket, so the samples
      // are set aside whole. Anything already a band stays one: it was
      // unresolvable when it was set aside and no later change resolves it.
      for (const [px, trail] of trails) {
        for (const sample of trail) {
          const k = `${px}:${sample.g}`;
          let band = bands.get(k);
          if (band === undefined) {
            band = { bucket: px, g: sample.g, bid: [], ask: [] };
            bands.set(k, band);
          }
          const into = sample.side === "bid" ? band.bid : band.ask;
          into.push(sample);
        }
      }
      trails.clear();
      bandRows.clear();
      bandKeys.clear();
    },
    trailAt: (px) => trails.get(px) ?? EMPTY_TRAIL,
    bandAt: (px) => {
      if (bands.size === 0) return EMPTY_TRAIL;
      let coverKey = bandKeys.get(px);
      if (coverKey === undefined) {
        coverKey = "";
        for (const [k, band] of bands) if (bandCovers(band, px)) coverKey += `${k},`;
        bandKeys.set(px, coverKey);
      }
      if (coverKey === "") return EMPTY_TRAIL;
      const hit = bandRows.get(coverKey);
      if (hit !== undefined) return hit;
      // One band covering the row on one side is the ordinary case, and it
      // hands back that band's own array: rows under one bucket then share it
      // by identity, which is what lets the renderer draw the block once.
      let built: ReadonlyArray<TrailSample> | undefined;
      let merged: TrailSample[] | undefined;
      for (const [k, band] of bands) {
        if (!coverKey.includes(`${k},`)) continue;
        const one = coveringSide(band, px);
        if (built === undefined && merged === undefined && one !== undefined) {
          built = one;
          continue;
        }
        merged ??= built === undefined ? [] : [...built];
        built = undefined;
        if (one !== undefined) merged.push(...one);
        else {
          merged.push(...band.bid, ...band.ask);
        }
      }
      if (merged !== undefined) {
        merged.sort((a, b) => a.t - b.t);
        built = merged;
      }
      const out = built ?? EMPTY_TRAIL;
      bandRows.set(coverKey, out);
      return out;
    },
    get: (side, px) => {
      const e = entries.get(key(side, px));
      return e === undefined ? undefined : view(e);
    },
    moving: () => {
      for (const e of entries.values()) if (e.pulses.length > 0 || e.spring.moving) return true;
      return false;
    },
    snap: () => {
      for (const e of entries.values()) {
        e.spring.snap(e.spring.target);
        e.pulses = [];
      }
    },
    clear: () => {
      entries.clear();
      trails.clear();
      bands.clear();
      bandRows.clear();
      bandKeys.clear();
    },
  };
}
