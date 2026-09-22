import type { LevelWatch, Metrics, Migration } from "../data/engine-api.types";
import type { Side } from "../data/feed-events.types";
import type { Tick } from "../domain/tick";
import type { TapeRow } from "./tape";

/**
 * One frame's worth of presentation facts, produced by the sampler from the
 * engine snapshot plus the animation state (v4's `sample(dt)` output `S`).
 * The rendering layer draws it and nothing else (ADR 0003, 0009).
 */

/** A pulse fired on a level; drawn by age against v4's decay constants (the ghost's width comes from the row's prev − live, as in v4). */
export type Pulse = {
  /** `fill` = a live print at this price; `consumed` = a book decrease attributed to trades (no trail dot). */
  readonly kind: "fill" | "consumed" | "ghost" | "add" | "grew";
  readonly t0: number;
};

/** One trail sample: the level's live size at frame time `t`. */
export type TrailSample = {
  readonly t: number;
  readonly sz: number;
};

/** One sample of the touch: best bid/ask ticks and bid share at frame time `t`. */
export type MidSample = {
  readonly t: number;
  readonly b: Tick;
  readonly a: Tick;
  readonly share: number;
};

/** One ladder row, top to bottom. */
export type FrameRow = {
  readonly i: number;
  readonly y: number;
  readonly px: Tick;
  readonly side: Side | "spread";
  /** Spring-eased size shown this frame. */
  readonly shown: number;
  /** Size the engine currently reports. */
  readonly live: number;
  /** Size before the last change; ghost width = prev − live. */
  readonly prev: number;
  readonly cum: number;
  readonly inRuler: boolean;
  /** Size-delta field value (ADR 0005). */
  readonly field: number;
  /** Live resiliency watch, when the level lost at least half its size. */
  readonly watch: LevelWatch | undefined;
  readonly pulses: ReadonlyArray<Pulse>;
  /** When the level first appeared, for persistence saturation. */
  readonly first: number;
  /** Size over the last 12 s, oldest first. */
  readonly trail: ReadonlyArray<TrailSample>;
};

/** The whole frame. */
export type FrameSample = {
  readonly t: number;
  readonly rows: ReadonlyArray<FrameRow>;
  readonly maxSz: number;
  readonly maxCum: number;
  readonly maxField: number;
  /** y of the spread ribbon, and the ruler band's [top, bottom]. */
  readonly ribY: number;
  readonly rulerY: readonly [number, number];
  readonly midIdx: number;
  readonly mid: number;
  readonly micro: number;
  /** Bid share of top-of-book size. */
  readonly share: number;
  readonly bestBid: Tick;
  readonly bestAsk: Tick;
  /**
   * True when both bests come from the BBO stream, i.e. they are the venue's
   * real touch. False means they are grouped book bests standing in, and no
   * price label may claim them (they can sit a whole grouping step apart).
   */
  readonly rawTouch: boolean;
  readonly bestBidSz: number;
  readonly bestAskSz: number;
  /** Touch history over the trails window, oldest first. */
  readonly midTrail: ReadonlyArray<MidSample>;
  /** Tape rows, newest first (empty when the tape is off). */
  readonly tape: ReadonlyArray<TapeRow>;
  /** P95 print size over five minutes; `Infinity` below 20 prints. */
  readonly tapeOutlier: number;
  /** Repricing pairs still fading. */
  readonly migrations: ReadonlyArray<Migration>;
  /** Book-wide metrics at the current notional, or `undefined` when overlays are off. */
  readonly metrics: Metrics | undefined;
  /** Last print and its direction relative to the print before it. */
  readonly lastTrade: { readonly px: Tick; readonly dir: -1 | 0 | 1 } | undefined;
};
