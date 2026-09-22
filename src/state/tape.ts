import type { Trade } from "../data/feed-events.types";
import type { Tick } from "../domain/tick";
import { pruneBefore } from "./trail";

/**
 * v4's trades tape: prints aggregated per venue block, price and side,
 * newest first, plus the outlier threshold (P95 of print sizes over the last
 * five minutes, only once enough prints exist to mean anything).
 */

/** Rows kept (v4 `TAPE_CAP`). */
const CAP = 50;
/** Window for the outlier threshold. */
const P95_WINDOW_MS = 300_000;
/** Prints needed before a threshold is reported. */
const P95_MIN_PRINTS = 20;

/** One tape row. */
export type TapeRow = {
  readonly px: Tick;
  readonly sz: number;
  /** Aggressor: `B` lifted the ask, `A` hit the bid. */
  readonly side: "B" | "A";
  /** Prints aggregated into this row. */
  readonly n: number;
  /** Venue block time; rows only aggregate within one block. */
  readonly time: number;
  /** Frame time the row last grew, for the age column and the enter flash. */
  readonly rx: number;
  /** Price direction against the previous print. */
  readonly dir: -1 | 0 | 1;
};

/** The tape store. */
export type Tape = {
  /** Fold live prints seen at frame time `t`. */
  readonly apply: (trades: ReadonlyArray<Trade>, t: number) => void;
  /** Rows, newest first. */
  readonly rows: () => ReadonlyArray<TapeRow>;
  /** P95 print size over the last five minutes, or `Infinity` below 20 prints. */
  readonly outlierSize: (t: number) => number;
  /** Forget everything (coin change). */
  readonly clear: () => void;
};

type MutableRow = { -readonly [K in keyof TapeRow]: TapeRow[K] };

/**
 * Create an empty tape.
 *
 * @returns The store.
 */
export function createTape(): Tape {
  let rows: MutableRow[] = [];
  let sizes: Array<{ readonly t: number; readonly sz: number }> = [];
  let lastPx: number | undefined;
  let lastDir: -1 | 0 | 1 = 0;
  return {
    apply: (trades, t) => {
      for (const tr of trades) {
        if (lastPx !== undefined && tr.px !== lastPx) lastDir = tr.px > lastPx ? 1 : -1;
        lastPx = tr.px;
        const head = rows[0];
        if (head !== undefined && head.time === tr.time && head.px === tr.px && head.side === tr.side) {
          head.sz += tr.sz;
          head.n++;
          head.rx = t;
        } else {
          rows.unshift({ px: tr.px, sz: tr.sz, side: tr.side, n: 1, time: tr.time, rx: t, dir: lastDir });
          if (rows.length > CAP) rows.pop();
        }
        sizes.push({ t, sz: tr.sz });
      }
    },
    rows: () => rows,
    outlierSize: (t) => {
      pruneBefore(sizes, t - P95_WINDOW_MS);
      if (sizes.length < P95_MIN_PRINTS) return Number.POSITIVE_INFINITY;
      const sorted = sizes.map((s) => s.sz).toSorted((a, b) => a - b);
      return sorted[Math.floor(0.95 * (sorted.length - 1))] ?? Number.POSITIVE_INFINITY;
    },
    clear: () => {
      rows = [];
      sizes = [];
      lastPx = undefined;
      lastDir = 0;
    },
  };
}
