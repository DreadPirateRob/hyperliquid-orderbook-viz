import { describe, expect, it } from "vitest";
import type { FrameSample } from "../state/frame-sample.types";
import { ROW } from "../state/sampler";
import * as Tick from "../domain/tick";
import { drawLadder } from "./ladder";
import { drawSpine } from "./spine";

/**
 * The renderer's only observable output is the sequence of canvas calls, so
 * alignment is asserted against a recording context: where a row's price text
 * lands versus the last-trade pill that must sit on the same line.
 */

type Call =
  | {
      readonly op: "fillText";
      readonly text: string;
      readonly x: number;
      readonly y: number;
      readonly baseline: CanvasTextBaseline;
    }
  | { readonly op: "roundRect"; readonly y: number; readonly h: number };

/** Metrics of the 12 px monospace stack under `textBaseline: "middle"`, measured in Chrome. */
const ASCENT = 5.734375;
const DESCENT = 3.265625;

function recordingContext(calls: Call[]): CanvasRenderingContext2D {
  const ctx = {
    textBaseline: "alphabetic" as CanvasTextBaseline,
    textAlign: "left" as CanvasTextAlign,
    font: "",
    fillStyle: "" as string | CanvasGradient,
    strokeStyle: "",
    lineWidth: 1,
    globalAlpha: 1,
    fillRect: () => {},
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
      actualBoundingBoxAscent: ASCENT,
      actualBoundingBoxDescent: DESCENT,
    }),
    fillText(text: string, x: number, y: number) {
      calls.push({ op: "fillText", text, x, y, baseline: ctx.textBaseline });
    },
    roundRect(_x: number, y: number, _w: number, h: number) {
      calls.push({ op: "roundRect", y, h });
    },
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

function frame(lastPx: number): FrameSample {
  const prices = [855500, 855490, 855480, 855470, 855460, 855450];
  const rows = prices.map((px, i) => ({
    i,
    y: i * ROW,
    px: tick(px),
    side: (px > 855475 ? "ask" : "bid") as "ask" | "bid",
    shown: 1,
    live: 1,
    prev: 1,
    cum: 1,
    inRuler: true,
    field: 0,
    watch: undefined,
    pulses: [],
    first: 0,
    trail: [],
    band: [],
  }));
  return {
    t: 1000,
    rows,
    maxSz: 1,
    maxCum: 1,
    maxField: 1,
    ribY: 3 * ROW,
    rulerY: [0, 6 * ROW],
    midIdx: 3,
    mid: 855475,
    micro: 855475,
    share: 0.5,
    bestBid: tick(855470),
    bestAsk: tick(855480),
    bestBidSz: 1,
    bestAskSz: 1,
    rawTouch: true,
    midTrail: [],
    migrations: [],
    metrics: undefined,
    tape: [],
    tapeOutlier: Number.POSITIVE_INFINITY,
    lastTrade: { px: tick(lastPx), dir: 0 },
  };
}

function draw(lastPx: number): Call[] {
  const calls: Call[] = [];
  const ctx = recordingContext(calls);
  drawLadder(
    {
      ctx,
      width: 1500,
      height: 6 * ROW,
      scale: scale(),
      gridTick: 10,
      trailsOn: false,
      tapeOn: false,
      overlaysOn: false,
    },
    frame(lastPx),
  );
  return calls;
}

function drawSpineCalls(lastPx: number): Call[] {
  const calls: Call[] = [];
  const ctx = recordingContext(calls);
  drawSpine(
    {
      ctx,
      width: 1500,
      height: 6 * ROW,
      scale: scale(),
      gridTick: 10,
      trailsOn: false,
      tapeOn: false,
      overlaysOn: false,
    },
    frame(lastPx),
  );
  return calls;
}

describe("spine tag alignment", () => {
  it("puts the pill text on the tagged row's line and its box on that row's band", () => {
    const calls = drawSpineCalls(855460);
    const pillText = calls.find(
      (c): c is Extract<Call, { op: "fillText" }> => c.op === "fillText" && c.text.includes("85546.0"),
    );
    const box = calls.find((c): c is Extract<Call, { op: "roundRect" }> => c.op === "roundRect");
    const rowCentre = 4 * ROW + ROW / 2;
    expect(pillText?.y).toBe(rowCentre);
    expect(box?.y).toBe(4 * ROW + 2);
    expect(box?.h).toBe(18);
  });

  it("right-aligns the pill at cx + 30 so it covers the centred row price (v4 ribbon1)", () => {
    const calls = drawSpineCalls(855460);
    const pillText = calls.find(
      (c): c is Extract<Call, { op: "fillText" }> => c.op === "fillText" && c.text.includes("85546.0"),
    );
    const rowPrice = calls.find(
      (c): c is Extract<Call, { op: "fillText" }> => c.op === "fillText" && c.text === "85546",
    );
    const cx = Math.round(1500 / 2);
    expect(pillText?.x).toBe(cx + 30 - 1);
    // the row price is centred on the spine, so the right-aligned pill must start left of its left edge
    const priceHalfWidth = ("85546".length * 7.2) / 2;
    const pillWidth = "85546.0".length * 7.2 + 10 + 10;
    expect(cx + 30 + 4 - pillWidth).toBeLessThan((rowPrice?.x ?? 0) - priceHalfWidth);
  });

  it("draws row prices on row centres", () => {
    const calls = drawSpineCalls(855460);
    const labels = calls.filter(
      (c): c is Extract<Call, { op: "fillText" }> => c.op === "fillText" && /^8554\d$/.test(c.text),
    );
    expect(labels.length).toBeGreaterThan(2);
    expect(labels.every((l) => l.y % ROW === ROW / 2)).toBe(true);
  });
});

describe("last-trade tag alignment", () => {
  it("draws the pill's text on the row's text line and its box on the row's rectangle band", () => {
    const calls = draw(855460);
    const labels = calls.filter(
      (c): c is Extract<Call, { op: "fillText" }> => c.op === "fillText" && /^8554\d$/.test(c.text),
    );
    const pillText = calls.find(
      (c): c is Extract<Call, { op: "fillText" }> => c.op === "fillText" && c.text.includes("85546.0"),
    );
    const box = calls.find((c): c is Extract<Call, { op: "roundRect" }> => c.op === "roundRect");
    expect(pillText, "the pill is drawn").toBeDefined();
    expect(box, "the pill box is drawn").toBeDefined();
    if (pillText === undefined || box === undefined) return;
    // The tagged row is 855460 = row index 4, so both texts share that row's centre.
    const rowCentre = 4 * ROW + ROW / 2;
    expect(pillText.y).toBe(rowCentre);
    expect(labels.every((l) => l.y % ROW === ROW / 2)).toBe(true);
    // Heat cells and block bars occupy y+2 .. y+19 of a 22 px row; the pill shares that band.
    expect(box.h).toBe(18);
    expect(box.y % ROW).toBe(2);
    expect(box.y + box.h / 2).toBe(rowCentre);
  });

  it("keeps the pill on a row centre when the print is outside the window", () => {
    const calls = draw(999999);
    const pillText = calls.find(
      (c): c is Extract<Call, { op: "fillText" }> => c.op === "fillText" && c.text.includes("99999.9"),
    );
    expect(pillText?.y).toBe(ROW / 2);
  });
});
