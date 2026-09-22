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

type RecentTrade = {
  readonly px: Tick;
  readonly sz: number;
  /** Side of the book the aggressor hit: a buy takes the ask. */
  readonly side: Side;
  readonly rx: number;
};

/**
 * Create the join.
 *
 * @returns An empty attribution.
 */
export function createAttribution(): Attribution {
  let recent: RecentTrade[] = [];
  let pending: PendingDecrease[] = [];

  const volumeAt = (side: Side, px: Tick, from: number, to: number): number => {
    let v = 0;
    for (const t of recent) if (t.px === px && t.side === side && t.rx > from && t.rx <= to) v += t.sz;
    return v;
  };

  return {
    addTrade: (trade, rx) => {
      recent.push({ px: trade.px, sz: trade.sz, side: trade.side === "B" ? "ask" : "bid", rx });
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
      return record;
    },
    reattribute: (t) => {
      const moved: Reattributed[] = [];
      for (const p of pending) {
        if (!p.open) continue;
        const consumed = Math.min(p.lost, volumeAt(p.side, p.px, p.from, p.at + GRACE_MS));
        if (consumed > p.consumed) {
          p.consumed = consumed;
          p.cancelled = p.lost - consumed;
          moved.push({ side: p.side, px: p.px, consumed: p.consumed, cancelled: p.cancelled });
        }
        if (t - p.at > GRACE_MS) p.open = false;
      }
      pending = pending.filter((p) => p.open);
      return moved;
    },
    prune: (t) => {
      recent = recent.filter((tr) => tr.rx >= t - TRADE_TTL_MS);
    },
    clear: () => {
      recent = [];
      pending = [];
    },
  };
}
