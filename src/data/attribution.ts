import type { Side, Trade } from "./feed-events.types";
import type { Tick } from "../domain/tick";

/**
 * Splitting a level's decrease into *consumed* (trades ate it) and
 * *cancelled* (the maker pulled it) is a heuristic temporal join, never a
 * fact the feed reports (ADR 0005): snapshots carry no order events. A print
 * can arrive after the book push that reflects it, so each decrease stays
 * open for a 600 ms grace window and is re-joined when later prints land.
 */

/** How long a decrease can still be re-attributed (v4 `GRACE`). */
const GRACE_MS = 600;
/** How long prints are kept for joining (v4 `recent`). */
const TRADE_TTL_MS = 15_000;

/** The heuristic split of one decrease. */
export type Split = {
  readonly consumed: number;
  readonly cancelled: number;
};

/** A decrease still inside its grace window. */
export type PendingDecrease = {
  readonly side: Side;
  readonly px: Tick;
  /** Size the level lost. */
  readonly lost: number;
  /** Start of the push window the decrease was observed in. */
  readonly from: number;
  /** Frame time the decrease was observed. */
  readonly at: number;
  consumed: number;
  cancelled: number;
  open: boolean;
};

/** A decrease whose split moved after the fact. */
export type Reattributed = {
  readonly side: Side;
  readonly px: Tick;
  /** Frame time the decrease was observed; identifies the window bucket it landed in. */
  readonly at: number;
  /** Split before this move, so an aggregate can be corrected without a scan. */
  readonly previous: Split;
  readonly consumed: number;
  readonly cancelled: number;
};

/** The attribution join. */
export type Attribution = {
  /** Record a live print seen at `rx`. */
  readonly addTrade: (trade: Trade, rx: number) => void;
  /** Split `lost` at `px` using prints in `(from, to]`. */
  readonly split: (side: Side, px: Tick, lost: number, from: number, to: number) => Split;
  /** Track a decrease so late prints can still claim it. */
  readonly openPending: (side: Side, px: Tick, lost: number, split: Split, from: number, at: number) => PendingDecrease;
  /** Re-join open decreases with prints that arrived since; returns those that moved. */
  readonly reattribute: (t: number) => ReadonlyArray<Reattributed>;
  /** Drop prints older than the join window. */
  readonly prune: (t: number) => void;
  /** Forget everything (coin change). */
  readonly clear: () => void;
};

/**
 * Prints at one price, in arrival order, with cumulative volume per side.
 * A join asks "how much traded in `(from, to]`", which two binary searches
 * and a subtraction answer — the flat scan it replaces is what made the
 * engine fall over in the burst benchmark, where the 15 s window can hold
 * six figures of prints at one price.
 */
type PriceBucket = {
  /** Arrival times, ascending. */
  readonly rx: number[];
  /** Cumulative size hitting the bid, by index. */
  readonly bid: number[];
  /** Cumulative size hitting the ask, by index. */
  readonly ask: number[];
  /**
   * Cumulative totals already dropped by `prune`. The sums that survive are
   * absolute, so a query whose lower bound precedes the first surviving entry
   * has to subtract what was removed — otherwise cleanup silently re-counts
   * expired prints as consumed volume.
   */
  base: { bid: number; ask: number };
};

/**
 * Create the join.
 *
 * @returns An empty attribution.
 */
export function createAttribution(): Attribution {
  // Prints are indexed by price and kept in arrival order within each bucket.
  // A join only ever asks about one price, and a burst benchmark showed the
  // flat scan is the engine's binding cost once the window holds thousands of
  // prints: at 100k events/s the 15 s window is six figures deep.
  let byPrice = new Map<Tick, PriceBucket>();
  let pending: PendingDecrease[] = [];
  /** Index of the oldest decrease still open; the queue in front of it is dead. */
  let pendingFrom = 0;
  /**
   * Open decreases by price, so a print re-joins only its own price. Each
   * bucket is append-ordered in time and consumed from `from`, so expiry is a
   * cursor bump rather than a rebuild of the bucket.
   */
  let pendingByPrice = new Map<Tick, { items: PendingDecrease[]; from: number }>();
  /** Prices that saw a print since the last join. */
  const dirty = new Set<Tick>();

  const volumeAt = (side: Side, px: Tick, from: number, to: number): number => {
    const bucket = byPrice.get(px);
    if (bucket === undefined) return 0;
    const lo = upperBound(bucket.rx, from);
    const hi = upperBound(bucket.rx, to) - 1;
    if (hi < lo) return 0;
    const cum = bucket[side];
    const start = lo > 0 ? (cum[lo - 1] ?? 0) : bucket.base[side];
    return (cum[hi] ?? 0) - start;
  };

  return {
    addTrade: (trade, rx) => {
      // A buy takes the ask.
      const side: Side = trade.side === "B" ? "ask" : "bid";
      let bucket = byPrice.get(trade.px);
      if (bucket === undefined) {
        bucket = { rx: [], bid: [], ask: [], base: { bid: 0, ask: 0 } };
        byPrice.set(trade.px, bucket);
      }
      const last = bucket.rx.length - 1;
      bucket.rx.push(rx);
      bucket.bid.push((bucket.bid[last] ?? 0) + (side === "bid" ? trade.sz : 0));
      bucket.ask.push((bucket.ask[last] ?? 0) + (side === "ask" ? trade.sz : 0));
      dirty.add(trade.px);
    },
    split: (side, px, lost, from, to) => {
      const consumed = Math.min(lost, volumeAt(side, px, from, to));
      return { consumed, cancelled: lost - consumed };
    },
    openPending: (side, px, lost, split, from, at) => {
      const record: PendingDecrease = {
        side,
        px,
        lost,
        from,
        at,
        consumed: split.consumed,
        cancelled: split.cancelled,
        open: true,
      };
      pending.push(record);
      const bucket = pendingByPrice.get(px);
      if (bucket === undefined) pendingByPrice.set(px, { items: [record], from: 0 });
      else bucket.items.push(record);
      return record;
    },
    reattribute: (t) => {
      const moved: Reattributed[] = [];
      // Only a price that has just printed can move a decrease, so the join
      // visits those prices instead of every open decrease. Expiry is a
      // separate front-of-queue walk: decreases open in arrival order.
      for (const px of dirty) {
        const bucket = pendingByPrice.get(px);
        if (bucket === undefined) continue;
        for (let i = bucket.from; i < bucket.items.length; i++) {
          const p = bucket.items[i];
          if (p === undefined || !p.open) continue;
          const consumed = Math.min(p.lost, volumeAt(p.side, p.px, p.from, p.at + GRACE_MS));
          if (consumed > p.consumed) {
            const previous = { consumed: p.consumed, cancelled: p.cancelled };
            p.consumed = consumed;
            p.cancelled = p.lost - consumed;
            moved.push({ side: p.side, px: p.px, at: p.at, previous, consumed, cancelled: p.cancelled });
          }
        }
      }
      dirty.clear();
      // Expiry walks the queue front: decreases open in arrival order. The
      // queue is consumed by cursor and compacted once it is mostly dead, so
      // neither this walk nor a long-lived hot price copies the whole array.
      while (pendingFrom < pending.length && t - (pending[pendingFrom]?.at ?? t) > GRACE_MS) {
        const p = pending[pendingFrom];
        if (p !== undefined) {
          p.open = false;
          const bucket = pendingByPrice.get(p.px);
          if (bucket !== undefined) {
            while (bucket.from < bucket.items.length && bucket.items[bucket.from]?.open === false) bucket.from++;
            if (bucket.from >= bucket.items.length) pendingByPrice.delete(p.px);
            else if (bucket.from > bucket.items.length / 2) {
              bucket.items.splice(0, bucket.from);
              bucket.from = 0;
            }
          }
        }
        pendingFrom++;
      }
      if (pendingFrom > pending.length / 2) {
        pending.splice(0, pendingFrom);
        pendingFrom = 0;
      }
      return moved;
    },
    prune: (t) => {
      const cutoff = t - TRADE_TTL_MS;
      for (const [px, bucket] of byPrice) {
        // Arrival order means expiry is a prefix: find it by search, not by walking.
        const drop = lowerBound(bucket.rx, cutoff);
        if (drop === 0) continue;
        if (drop >= bucket.rx.length) {
          byPrice.delete(px);
          continue;
        }
        // Remember what the dropped prefix already accounted for; the
        // surviving sums stay absolute.
        bucket.base = { bid: bucket.bid[drop - 1] ?? 0, ask: bucket.ask[drop - 1] ?? 0 };
        bucket.rx.splice(0, drop);
        bucket.bid.splice(0, drop);
        bucket.ask.splice(0, drop);
      }
    },
    clear: () => {
      byPrice = new Map();
      pending = [];
      pendingFrom = 0;
      pendingByPrice = new Map();
      dirty.clear();
    },
  };
}

/** First index whose value is `> value`; the array is ascending. */
function upperBound(values: ReadonlyArray<number>, value: number): number {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((values[mid] ?? 0) > value) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** First index whose value is `>= value`; the array is ascending. */
function lowerBound(values: ReadonlyArray<number>, value: number): number {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((values[mid] ?? 0) >= value) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}
