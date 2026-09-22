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
/** Median refill time is taken over this window. */
const REFILL_WINDOW_MS = 300_000;

function key(side: Side, px: Tick): string {
  return `${side}:${px}`;
}

/** A level being watched after losing at least half its size. */
export type Watch = {
  readonly startedAt: number;
  /** Size before the loss. */
  readonly before: number;
  /** Refill time in ms, `Infinity` once capped, `undefined` while pending. */
  done: number | undefined;
  /** Size ratio five seconds in, `undefined` while pending. */
  at5s: number | undefined;
};

/** One decrease in the per-side window. */
type SideEvent = {
  readonly t: number;
  readonly consumed: number;
  readonly cancelled: number;
  hit: boolean;
};

/** Per-price metric state. */
export type LevelStat = {
  readonly side: Side;
  readonly px: Tick;
  /** Decayed size-delta accumulator and when it was last updated. */
  field: number;
  fieldAt: number;
  size: number;
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
  /** Move an already-recorded decrease from cancelled to consumed (deferred attribution). */
  readonly reattribute: (side: Side, px: Tick, consumed: number, cancelled: number) => void;
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
  const events: Record<Side, SideEvent[]> = { bid: [], ask: [] };
  const refills: Record<Side, Array<{ readonly t: number; readonly ms: number; readonly at5s: number | undefined }>> = {
    bid: [],
    ask: [],
  };
  const stat = (side: Side, px: Tick, t: number): LevelStat => {
    const k = key(side, px);
    let s = stats.get(k);
    if (s === undefined) {
      s = { side, px, field: 0, fieldAt: t, size: 0, watch: undefined };
      stats.set(k, s);
    }
    return s;
  };

  return {
    change: (side, px, before, after, t, countable, split) => {
      const s = stat(side, px, t);
      s.field = decayField(s.field, t - s.fieldAt, TAU_F, after - before);
      s.fieldAt = t;
      s.size = after;
      if (after >= before) return;
      if (countable)
        events[side].push({ t, consumed: split.consumed, cancelled: split.cancelled, hit: split.consumed > 0 });
      if (s.watch === undefined && before > 0 && (before - after) / before >= RES_TRIGGER) {
        s.watch = { startedAt: t, before, done: undefined, at5s: undefined };
      }
    },
    reattribute: (side, px, consumed, cancelled) => {
      const list = events[side];
      for (let i = list.length - 1; i >= 0; i--) {
        const e = list[i];
        if (e === undefined || e.consumed + e.cancelled !== consumed + cancelled) continue;
        list[i] = { t: e.t, consumed, cancelled, hit: consumed > 0 };
        return;
      }
      void px;
    },
    tick: (t) => {
      for (const s of stats.values()) {
        const w = s.watch;
        if (w === undefined) continue;
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
      const list = events[side];
      while (list.length > 0 && (list[0]?.t ?? t) < t - RATIO_WINDOW_MS) list.shift();
      const recent = refills[side];
      while (recent.length > 0 && (recent[0]?.t ?? t) < t - REFILL_WINDOW_MS) recent.shift();
      let consumed = 0;
      let cancelled = 0;
      let hits = 0;
      let churnEvents = 0;
      let churnVolume = 0;
      for (const e of list) {
        consumed += e.consumed;
        cancelled += e.cancelled;
        if (e.hit) hits++;
        if (e.t >= t - CHURN_WINDOW_MS) {
          churnEvents++;
          churnVolume += e.consumed + e.cancelled;
        }
      }
      const times = recent.map((r) => r.ms).toSorted((a, b) => a - b);
      const at5s = recent
        .map((r) => r.at5s)
        .filter((v): v is number => v !== undefined)
        .toSorted((a, b) => a - b);
      return {
        eventChurn: churnEvents / (CHURN_WINDOW_MS / 1000),
        volumeChurn: churnVolume / (CHURN_WINDOW_MS / 1000),
        cancelRatioCount: list.length > 0 ? 1 - hits / list.length : Number.NaN,
        cancelRatioVolume: consumed + cancelled > 0 ? cancelled / (consumed + cancelled) : Number.NaN,
        medianRefillMs: times[times.length >> 1],
        refillAt5s: at5s[at5s.length >> 1],
      };
    },
    watch: (side, px) => stats.get(key(side, px))?.watch,
    clear: () => {
      stats.clear();
      events.bid = [];
      events.ask = [];
      refills.bid = [];
      refills.ask = [];
    },
  };
}
