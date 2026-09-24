import { describe, expect, it } from "vitest";
import type { FrameRow, FrameSample, TrailSample } from "../state/frame-sample.types";
import { ROW } from "../state/sampler";
import { TRAIL_DT } from "../state/trail";
import * as Tick from "../domain/tick";
import { drawLadder, ladderLayout } from "./ladder";

/**
 * The trail column is history. What it shows happened, and nothing about the
 * present frame can unhappen it: a level whose liquidity dries out keeps the
 * tiles it earned until they age out of the window, the same as a level that
 * is merely quiet. The renderer's only observable output is its canvas calls,
 * so this asserts the tiles are painted, not that the samples exist.
 */

type Rect = { readonly x: number; readonly y: number; readonly w: number };

function recordingContext(rects: Rect[]): CanvasRenderingContext2D {
  const ctx = {
    textBaseline: "alphabetic" as CanvasTextBaseline,
    textAlign: "left" as CanvasTextAlign,
    font: "",
    fillStyle: "" as string | CanvasGradient,
    strokeStyle: "",
    lineWidth: 1,
    globalAlpha: 1,
    fillRect(x: number, y: number, w: number) {
      rects.push({ x, y, w });
    },
    strokeRect: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    closePath: () => {},
    fill: () => {},
    stroke: () => {},
    save: () => {},
    restore: () => {},
    rect: () => {},
    clip: () => {},
    arc: () => {},
    arcTo: () => {},
    setLineDash: () => {},
    createLinearGradient: () => ({ addColorStop: () => {} }),
    measureText: (s: string) => ({
      width: s.length * 7.2,
      actualBoundingBoxAscent: 5.7,
      actualBoundingBoxDescent: 3.2,
    }),
    fillText: () => {},
    roundRect: () => {},
  };
  // SAFETY: the renderer only uses the 2d calls stubbed above; a full context cannot be built in Node.
  return ctx as unknown as CanvasRenderingContext2D;
}

function scale(): Tick.PriceScale {
  const r = Tick.makeScale("perp", 5);
  if (r._tag === "err") throw r.error;
  return r.value;
}

function tick(n: number): Tick.Tick {
  const r = Tick.fromInteger(n);
  if (r._tag === "err") throw r.error;
  return r.value;
}

const T = 100_000;

/** A full window of tiles at one price, all of them worth drawing. */
function trail(side: "bid" | "ask"): ReadonlyArray<TrailSample> {
  const out: TrailSample[] = [];
  for (let k = 20; k >= 1; k--) out.push({ t: T - k * TRAIL_DT, sz: 5, rel: 0.6, sat: 1, side });
  return out;
}

type RowOverrides = Partial<FrameRow> & Pick<FrameRow, "px" | "side">;

function row(i: number, o: RowOverrides): FrameRow {
  return {
    i,
    y: i * ROW,
    shown: 5,
    live: 5,
    prev: 5,
    cum: 5,
    inRuler: true,
    field: 0,
    watch: undefined,
    pulses: [],
    first: 0,
    trail: trail(o.side === "ask" ? "ask" : "bid"),
    ...o,
  };
}

const WIDTH = 900;

/** Rectangles landing inside the trail column, which only `trailStrip` paints. */
function tilesOn(rects: ReadonlyArray<Rect>, r: FrameRow): ReadonlyArray<Rect> {
  const X = ladderLayout(WIDTH, true, false);
  return rects.filter((q) => q.x >= X.trail && q.x < X.trail + X.trailW && q.y >= r.y && q.y < r.y + ROW && q.w > 0);
}

function draw(rows: ReadonlyArray<FrameRow>): ReadonlyArray<Rect> {
  const rects: Rect[] = [];
  const S: FrameSample = {
    t: T,
    rows,
    maxSz: 10,
    maxCum: 50,
    maxField: 1,
    ribY: ROW,
    rulerY: [0, rows.length * ROW],
    midIdx: 1,
    mid: 1005,
    micro: 1005,
    share: 0.5,
    bestBid: tick(1000),
    bestAsk: tick(1010),
    rawTouch: true,
    bestBidSz: 1,
    bestAskSz: 1,
    midTrail: [],
    tape: [],
    tapeOutlier: Number.POSITIVE_INFINITY,
    migrations: [],
    metrics: undefined,
    lastTrade: undefined,
  };
  drawLadder(
    {
      ctx: recordingContext(rects),
      width: WIDTH,
      height: rows.length * ROW,
      scale: scale(),
      gridTick: 10,
      trailsOn: true,
      tapeOn: false,
      overlaysOn: false,
    },
    S,
  );
  return rects;
}

describe("painted history outlives the liquidity that made it", () => {
  it("keeps a dried-up level's tiles after its size reaches zero", () => {
    // The level is empty and every pulse has long expired: by the present
    // frame there is nothing at this price at all. The past is unchanged.
    const drained = row(1, { px: tick(1000), side: "bid", shown: 0, live: 0, prev: 8, pulses: [] });
    const rows = [row(0, { px: tick(1010), side: "ask" }), drained];
    expect(tilesOn(draw(rows), drained).length, "a drained level's history must still be painted").toBeGreaterThan(10);
  });

  it("draws the same tiles whether or not the level still has size", () => {
    // Size is a property of now; the strip is a property of then. Draining a
    // level must change nothing to the left of the present edge.
    const px = tick(1000);
    const live = row(1, { px, side: "bid" });
    const drained = row(1, { px, side: "bid", shown: 0, live: 0 });
    const ask = row(0, { px: tick(1010), side: "ask" });
    expect(tilesOn(draw([ask, drained]), drained)).toEqual(tilesOn(draw([ask, live]), live));
  });

  it("keeps the tiles of a price the spread has swallowed", () => {
    // A widening spread is the moment most worth reading, and the price it
    // swallows is the one that says why.
    const swallowed = row(1, { px: tick(1000), side: "spread", shown: 0, live: 0 });
    const rows = [row(0, { px: tick(1010), side: "ask" }), swallowed, row(2, { px: tick(990), side: "bid" })];
    expect(tilesOn(draw(rows), swallowed).length, "a spread row still has a past").toBeGreaterThan(10);
  });
});
