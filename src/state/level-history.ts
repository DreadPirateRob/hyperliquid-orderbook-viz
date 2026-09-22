import type { LevelEvent } from "../data/engine-api.types";
import type { Side, Trade } from "../data/feed-events.types";
import type { Tick } from "../domain/tick";
import { casesHandled } from "../shared/result";
import type { Pulse } from "./frame-sample.types";
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
  /** OS reduced-motion preference: springs snap, pulses are not recorded. */
  readonly reducedMotion: boolean;
};

/** The store. */
export type LevelHistory = {
  /** Fold engine level events at frame time `t`. */
  readonly applyLevelEvents: (events: ReadonlyArray<LevelEvent>, t: number) => void;
  /** Fire fill pulses for live prints at frame time `t`. */
  readonly applyTrades: (trades: ReadonlyArray<Trade>, t: number) => void;
  /** Advance springs, prune pulses and dead levels. */
  readonly step: (t: number, dt: number) => void;
  /** Look up one level's state. */
  readonly get: (side: Side, px: Tick) => LevelState | undefined;
  /** True while any spring or pulse is live. */
  readonly moving: () => boolean;
  /** Settle every spring and drop pulses (tab return, reduced motion). */
  readonly snap: () => void;
  /** Forget everything (coin/grouping change). */
  readonly clear: () => void;
};

function key(side: Side, px: Tick): string {
  return `${side}:${px}`;
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

/**
 * Create an empty history.
 *
 * @param options - Motion preferences.
 * @returns The store.
 */
export function createLevelHistory(options: LevelHistoryOptions): LevelHistory {
  const entries = new Map<string, Entry>();
  const rec = (side: Side, px: Tick, t: number): Entry => {
    const k = key(side, px);
    let e = entries.get(k);
    if (e === undefined) {
      e = { side, px, first: t, lastChanged: t, live: 0, prev: 0, spring: new Spring(0, SIZE_K, SIZE_C), pulses: [] };
      entries.set(k, e);
    }
    return e;
  };
  const pulse = (e: Entry, kind: Pulse["kind"], t: number): void => {
    if (options.reducedMotion) return;
    e.pulses.push({ kind, t0: t });
    if (e.pulses.length > PULSE_CAP) e.pulses.shift();
  };
  const setSize = (e: Entry, size: number, t: number): void => {
    e.prev = e.live;
    e.live = size;
    e.lastChanged = t;
    if (options.reducedMotion) e.spring.snap(size);
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
            if (e.live === 0 && e.spring.x < 1e-9) e.first = t;
            setSize(e, ev.to, t);
            pulse(e, "add", t);
            break;
          case "grew":
            setSize(e, ev.to, t);
            pulse(e, "grew", t);
            break;
          case "shrank":
          case "vanished":
            setSize(e, ev.to, t);
            pulse(e, ev.consumed > 0 ? "fill" : "ghost", t);
            break;
          case "outOfWindow":
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
    clear: () => entries.clear(),
  };
}
