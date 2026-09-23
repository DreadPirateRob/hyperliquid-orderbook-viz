import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import * as Grouping from "../src/domain/grouping";
import { createEngine } from "../src/data/engine";
import type { FeedEvent } from "../src/data/feed-events.types";
import { parseFixture } from "../src/data/fixture";
import { parseWireMessage } from "../src/data/wire";

/**
 * Engine burst harness (ADR 0006). The live feed peaks near 30 events/s, so
 * every rate here is **synthetic**: real recorded frames, re-stamped onto a
 * faster clock and replayed back to back. What it measures is headroom, not
 * the venue.
 *
 * Latency is measured per `apply` rather than as throughput alone: a p99 that
 * blows past a frame budget matters even when the mean is fine.
 */

/** Host tick cadence the runtime uses (`runtime.ts`). */
const HOST_TICK_MS = 500;

/** One rate's result; `sustained` is what the engine achieved, not what was asked for. */
export type BurstResult = {
  /** Events per second the synthetic stream was stamped at. */
  readonly rate: number;
  /** Seconds of synthetic stream time. */
  readonly seconds: number;
  readonly events: number;
  /** Achieved events per second, wall clock. */
  readonly sustained: number;
  readonly applyP50Us: number;
  readonly applyP99Us: number;
  readonly heapDeltaMb: number;
  /** Always true: no venue produces these rates (ADR 0006). */
  readonly synthetic: true;
};

/** Recorded frames in arrival order, ready to be re-stamped. */
export type BurstSource = {
  readonly events: ReadonlyArray<FeedEvent>;
  readonly gridTick: number;
  readonly mix: Readonly<Record<string, number>>;
};

/**
 * Parse a recording into applicable events, keeping the observed stream mix.
 *
 * @param path - Gzipped recording.
 * @returns The event ring the burst replays.
 */
export function loadBurstSource(path: string): BurstSource {
  const parsed = parseFixture(gunzipSync(readFileSync(path)).toString("utf8"));
  if (parsed._tag === "err") throw parsed.error;
  const fx = parsed.value;
  const events: FeedEvent[] = [];
  const mix: Record<string, number> = {};
  let historical = true;
  for (const line of fx.lines) {
    if (line._tag !== "frame") continue;
    const r = parseWireMessage(line.frame, {
      coin: fx.meta.coin,
      scale: fx.meta.scale,
      rx: line.rx,
      tradesHistorical: historical,
    });
    if (r._tag === "err" || r.value._tag === "ignored") continue;
    if (r.value._tag === "trades") historical = false;
    const key = r.value._tag === "l2Book" ? `l2Book:${r.value.stream}` : r.value._tag;
    mix[key] = (mix[key] ?? 0) + 1;
    events.push(r.value);
  }
  const first = events.find((e) => e._tag === "l2Book");
  if (first === undefined || first._tag !== "l2Book") throw new Error("recording has no book push");
  const bid = first.bids[0];
  const ask = first.asks[0];
  if (bid === undefined || ask === undefined) throw new Error("recording's first push has no touch");
  const mid = ((bid.px + ask.px) / 2) * 10 ** -fx.meta.scale.decimals;
  return { events, gridTick: Grouping.gridTickFor(mid, fx.meta.precision, fx.meta.scale), mix };
}

/**
 * Replay `rate × seconds` synthetic events through one engine as fast as it
 * will take them.
 *
 * @param source - Recorded events to re-stamp.
 * @param rate - Synthetic events per second.
 * @param seconds - Seconds of synthetic stream time.
 * @returns Sustained rate, apply latency percentiles and heap delta.
 */
export function runBurst(source: BurstSource, rate: number, seconds: number): BurstResult {
  const total = rate * seconds;
  const engine = createEngine({ gridTick: source.gridTick });
  const step = 1000 / rate;
  const latencies = new Float64Array(total);
  const ring = source.events;
  // The runtime ticks the engine every 500 ms of wall clock; that tick is what
  // prunes the trade-attribution window. A burst without it measures an
  // unpruned engine, not the one that ships — per-trade cost grows without
  // bound. Ticks are on the synthetic clock and are not counted as feed events.
  let nextTick = HOST_TICK_MS;
  const drive = (i: number): void => {
    const rx = i * step;
    if (rx < nextTick) return;
    nextTick = rx + HOST_TICK_MS;
    engine.apply({ _tag: "tick", rx });
  };
  // Warm the JIT and the engine's stores so the measured run is steady state.
  for (let i = 0; i < Math.min(ring.length, 2000); i++) {
    engine.apply(stamp(ring[i % ring.length], i * step));
    drive(i);
  }
  engine.drain();
  globalThis.gc?.();
  const heapBefore = process.memoryUsage().heapUsed;
  const started = performance.now();
  for (let i = 0; i < total; i++) {
    const event = stamp(ring[i % ring.length], i * step);
    const t0 = performance.now();
    engine.apply(event);
    latencies[i] = (performance.now() - t0) * 1000;
    drive(i);
    // The widget drains every frame; a burst that never drains measures a leak, not the engine.
    if (i % 60 === 0) {
      engine.drain();
      engine.drainTrades();
      engine.drainMigrations();
    }
  }
  const elapsed = performance.now() - started;
  const heapAfter = process.memoryUsage().heapUsed;
  latencies.sort();
  const at = (q: number): number => latencies[Math.min(total - 1, Math.floor(q * total))] ?? 0;
  return {
    rate,
    seconds,
    events: total,
    sustained: Math.round(total / (elapsed / 1000)),
    applyP50Us: round(at(0.5), 2),
    applyP99Us: round(at(0.99), 2),
    heapDeltaMb: round((heapAfter - heapBefore) / 1024 / 1024, 1),
    synthetic: true,
  };
}

/** Re-stamp a recorded event onto the synthetic clock; `rx` drives staleness and attribution. */
function stamp(event: FeedEvent | undefined, rx: number): FeedEvent {
  if (event === undefined) throw new Error("empty event ring");
  return { ...event, rx };
}

function round(v: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}
