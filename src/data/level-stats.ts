import type { Tick } from "../domain/tick";
import type { Side } from "./feed-events.types";
import { decayField } from "./metrics";

/**
 * The engine's metric state that outlives a single push: the per-price
 * size-delta field, resiliency watches, and the rolling per-side event window
 * behind churn and cancel ratios (Derived Metrics Definitions).
 */

/** Size-delta decay constant (v4 `TAU_F`). */
const TAU_F = 3000;
/** Resiliency: watch starts at this loss, completes at this refill, gives up after this long. */
const RES_TRIGGER = 0.5;
const RES_TARGET = 0.8;
const RES_CAP_MS = 30_000;
/** Cancel ratios look back this far; churn this far (v4/Derived Metrics). */
const RATIO_WINDOW_MS = 60_000;
const CHURN_WINDOW_MS = 5000;
/** Idle prices are evicted after this long with a fully decayed field. */
const IDLE_EVICT_MS = 60_000;
const FIELD_EPSILON = 1e-9;
/** Median refill time is taken over this window. */
const REFILL_WINDOW_MS = 300_000;

function key(side: Side, px: Tick): string {
  return `${side}:${px}`;
}

/** Mutable form of the engine's `LevelWatch`. */
export type Watch = {
  readonly startedAt: number;
  readonly before: number;
  done: number | undefined;
  at5s: number | undefined;
};

/**
 * The rolling window is kept as fixed 250 ms buckets, not one entry per
 * decrease: at a live 30 events/s either shape is trivial, but the window is
 * 60 s long, so a per-event list grows with the event rate and every read
 * walks it. Buckets make a read constant-cost and a correction O(1).
 */
const BUCKET_MS = 250;
const BUCKETS = Math.ceil(RATIO_WINDOW_MS / BUCKET_MS) + 1;

/** One 250 ms slice of a side's decreases. */
type Bucket = {
  /** Slice index (`floor(t / BUCKET_MS)`); identifies which window this holds. */
  id: number;
  count: number;
  hits: number;
  consumed: number;
  cancelled: number;
};

/** Per-price metric state. */
export type LevelStat = {
  readonly side: Side;
  readonly px: Tick;
  /** Decayed size-delta accumulator and when it was last updated. */
  field: number;
  fieldAt: number;
  size: number;
  /** Last time this price was touched; idle entries are evicted so the store tracks the live book. */
  lastAt: number;
  watch: Watch | undefined;
};

/** Churn and ratio figures for one side. */
export type SideWindow = {
  readonly eventChurn: number;
  readonly volumeChurn: number;
  readonly cancelRatioCount: number;
  readonly cancelRatioVolume: number;
  readonly medianRefillMs: number | undefined;
  readonly refillAt5s: number | undefined;
};

/** The metric state store. */
export type LevelStats = {
  /** Fold one level change: `delta` is the signed size change. */
  readonly change: (
    side: Side,
    px: Tick,
    before: number,
    after: number,
    t: number,
    countable: boolean,
    split: { consumed: number; cancelled: number },
  ) => void;
  /**
   * Correct an already-recorded decrease whose split moved (deferred
   * attribution): `at` locates its bucket, so no scan is needed.
   */
  readonly reattribute: (
    side: Side,
    at: number,
    previous: { consumed: number; cancelled: number },
    next: { consumed: number; cancelled: number },
  ) => void;
  /** Advance resiliency watches. */
  readonly tick: (t: number) => void;
  /** Field value at `t` for one price, decayed. */
  readonly fieldAt: (side: Side, px: Tick, t: number) => number;
  /** Sum of the decayed field over a side. */
  readonly fieldSum: (side: Side, t: number) => number;
  /** Rolling window figures for a side. */
  readonly window: (side: Side, t: number) => SideWindow;
  /** Live watch for a price, for the resiliency overlay. */
  readonly watch: (side: Side, px: Tick) => Watch | undefined;
  /** Forget everything. */
  readonly clear: () => void;
};

/**
 * Create the metric state store.
 *
 * @returns Empty stats.
 */
export function createLevelStats(): LevelStats {
  const stats = new Map<string, LevelStat>();
  // One ring of fixed slices per side; `bucketAt` reuses a slot once its id is stale.
  const windows: Record<Side, Bucket[]> = { bid: makeRing(), ask: makeRing() };
  const refills: Record<Side, Array<{ readonly t: number; readonly ms: number; readonly at5s: number | undefined }>> = {
    bid: [],
    ask: [],
  };
  /** Index of the first live refill per side; trimming moves the cursor, never the array. */
  const refillFrom: Record<Side, number> = { bid: 0, ask: 0 };
  const stat = (side: Side, px: Tick, t: number): LevelStat => {
    const k = key(side, px);
    let s = stats.get(k);
    if (s === undefined) {
      s = { side, px, field: 0, fieldAt: t, size: 0, lastAt: t, watch: undefined };
      stats.set(k, s);
    }
    s.lastAt = t;
    return s;
  };
  /** The slice `t` belongs to, recycled in place when the ring wraps. */
  const bucketAt = (side: Side, t: number): Bucket => {
    const id = Math.floor(t / BUCKET_MS);
    const slot = windows[side][((id % BUCKETS) + BUCKETS) % BUCKETS];
    if (slot === undefined) throw new Error("window ring is not allocated");
    if (slot.id !== id) {
      slot.id = id;
      slot.count = 0;
      slot.hits = 0;
      slot.consumed = 0;
      slot.cancelled = 0;
    }
    return slot;
  };

  return {
    change: (side, px, before, after, t, countable, split) => {
      const s = stat(side, px, t);
      s.field = decayField(s.field, t - s.fieldAt, TAU_F, after - before);
      s.fieldAt = t;
      s.size = after;
      if (after >= before) return;
      if (countable) {
        const b = bucketAt(side, t);
        b.count++;
        b.consumed += split.consumed;
        b.cancelled += split.cancelled;
        if (split.consumed > 0) b.hits++;
      }
      if (s.watch === undefined && before > 0 && (before - after) / before >= RES_TRIGGER) {
        s.watch = { startedAt: t, before, done: undefined, at5s: undefined };
      }
    },
    reattribute: (side, at, previous, next) => {
      const id = Math.floor(at / BUCKET_MS);
      const slot = windows[side][((id % BUCKETS) + BUCKETS) % BUCKETS];
      // The decrease's slice may already have rolled out of the window; then
      // there is nothing to correct, which is the same answer as before.
      if (slot === undefined || slot.id !== id) return;
      slot.consumed += next.consumed - previous.consumed;
      slot.cancelled += next.cancelled - previous.cancelled;
      if (previous.consumed <= 0 && next.consumed > 0) slot.hits++;
    },
    tick: (t) => {
      for (const [k, s] of stats) {
        const w = s.watch;
        if (w === undefined) {
          // Evict idle prices: the field has decayed to nothing and the book
          // has moved on, so keeping the entry only makes every sweep longer.
          if (t - s.lastAt > IDLE_EVICT_MS && Math.abs(decayField(s.field, t - s.fieldAt, TAU_F)) < FIELD_EPSILON) {
            stats.delete(k);
          }
          continue;
        }
        if (w.at5s === undefined && t - w.startedAt >= 5000) w.at5s = s.size / w.before;
        if (w.done === undefined) {
          if (s.size >= RES_TARGET * w.before) w.done = t - w.startedAt;
          else if (t - w.startedAt >= RES_CAP_MS) w.done = Number.POSITIVE_INFINITY;
        }
        if (w.done !== undefined && w.at5s !== undefined) {
          refills[s.side].push({ t, ms: w.done, at5s: w.at5s });
          if (t - w.startedAt > RES_CAP_MS + 5000) s.watch = undefined;
        }
      }
    },
    fieldAt: (side, px, t) => {
      const s = stats.get(key(side, px));
      return s === undefined ? 0 : decayField(s.field, t - s.fieldAt, TAU_F);
    },
    fieldSum: (side, t) => {
      let sum = 0;
      for (const s of stats.values()) if (s.side === side) sum += decayField(s.field, t - s.fieldAt, TAU_F);
      return sum;
    },
    window: (side, t) => {
      const oldest = Math.floor((t - RATIO_WINDOW_MS) / BUCKET_MS);
      const churnFrom = Math.floor((t - CHURN_WINDOW_MS) / BUCKET_MS);
      let consumed = 0;
      let cancelled = 0;
      let hits = 0;
      let count = 0;
      let churnEvents = 0;
      let churnVolume = 0;
      for (const b of windows[side]) {
        if (b.id < oldest) continue;
        consumed += b.consumed;
        cancelled += b.cancelled;
        hits += b.hits;
        count += b.count;
        if (b.id >= churnFrom) {
          churnEvents += b.count;
          churnVolume += b.consumed + b.cancelled;
        }
      }
      // Refills are rare (one per completed resiliency watch): trim by cursor.
      const all = refills[side];
      let from = refillFrom[side];
      while (from < all.length && (all[from]?.t ?? t) < t - REFILL_WINDOW_MS) from++;
      if (from > all.length / 2) {
        all.splice(0, from);
        from = 0;
      }
      refillFrom[side] = from;
      const recent = all.slice(from);
      const times = recent.map((r) => r.ms).toSorted((a, b) => a - b);
      const at5s = recent
        .map((r) => r.at5s)
        .filter((v): v is number => v !== undefined)
        .toSorted((a, b) => a - b);
      return {
        eventChurn: churnEvents / (CHURN_WINDOW_MS / 1000),
        volumeChurn: churnVolume / (CHURN_WINDOW_MS / 1000),
        cancelRatioCount: count > 0 ? 1 - hits / count : Number.NaN,
        cancelRatioVolume: consumed + cancelled > 0 ? cancelled / (consumed + cancelled) : Number.NaN,
        medianRefillMs: times[times.length >> 1],
        refillAt5s: at5s[at5s.length >> 1],
      };
    },
    watch: (side, px) => stats.get(key(side, px))?.watch,
    clear: () => {
      stats.clear();
      windows.bid = makeRing();
      windows.ask = makeRing();
      refills.bid = [];
      refills.ask = [];
      refillFrom.bid = 0;
      refillFrom.ask = 0;
    },
  };
}

/** A fresh ring of empty slices; `id: -1` marks a slot that has never been used. */
function makeRing(): Bucket[] {
  return Array.from({ length: BUCKETS }, () => ({ id: -1, count: 0, hits: 0, consumed: 0, cancelled: 0 }));
}
