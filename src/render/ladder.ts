import * as Tick from "../domain/tick";
import type { FrameRow, FrameSample, Pulse } from "../state/frame-sample.types";
import { ROW } from "../state/sampler";
import { TRAIL_DT, TRAIL_MS } from "../state/trail";
import type { PriceScale } from "../domain/tick";
import type { DrawContext } from "./draw.types";
import { TAPE_W } from "./tape";
import type { Rgb } from "./palette";
import { FONT, PALETTE, formatSize, pill, rgba, sideColour, text } from "./palette";

/**
 * v4's `drawLadder`: the classic ladder view. This module carries the static
 * parts — profile, heat cell, block, labels, ruler; pulses, trails, overlays
 * and the boundary arrive with their tickets.
 */

/** v4 layout constants. */
const BLOCK_W = 300;
const GUTTER_W = 170;
const PERSISTENCE_MS = 20000;
const RULER_DIM = 0.45;

/** Column x positions (v4's `X`). */
export type LadderLayout = {
  readonly px: number;
  readonly heat: number;
  readonly lane: number;
  readonly block: number;
  readonly blockW: number;
  readonly size: number;
  readonly trail: number;
  readonly trailW: number;
  /** Width available to the ladder (tape excluded). */
  readonly ladderW: number;
};

/**
 * v4's column layout for the current width and toggles.
 *
 * @param width - Canvas width in CSS px.
 * @param trailsOn - Trails column present.
 * @param tapeOn - Tape column present.
 * @returns Column positions.
 */
export function ladderLayout(width: number, trailsOn: boolean, tapeOn: boolean): LadderLayout {
  const ladderW = tapeOn ? width - TAPE_W : width;
  if (trailsOn) {
    const block = ladderW - BLOCK_W - GUTTER_W;
    const heat = block - 30;
    const px = heat - 12;
    const trail = 8;
    return {
      px,
      heat,
      lane: heat + 18,
      block,
      blockW: BLOCK_W,
      size: 0,
      trail,
      trailW: Math.max(120, px - 150 - trail),
      ladderW,
    };
  }
  return {
    px: 80,
    heat: 110,
    lane: 130,
    block: 230,
    blockW: Math.min(360, ladderW - 230 - 260),
    size: 200,
    trail: 215,
    trailW: 0,
    ladderW,
  };
}

/** v4 pulse decay constants (ms). */
const PULSE_TAU: Record<Pulse["kind"], number> = { fill: 500, consumed: 500, ghost: 700, add: 450, grew: 400 };

/** Intensity per drawn effect at frame time `t` (v4 `pulseState`): fill and consumed share the fill effect; the strongest wins. */
export function pulseState(pulses: ReadonlyArray<Pulse>, t: number): Record<"fill" | "ghost" | "add" | "grew", number> {
  const o = { fill: 0, ghost: 0, add: 0, grew: 0 };
  for (const p of pulses) {
    const v = Math.exp(-(t - p.t0) / PULSE_TAU[p.kind]);
    const slot = p.kind === "consumed" ? "fill" : p.kind;
    if (v > o[slot]) o[slot] = v;
  }
  return o;
}

/**
 * x of a trail sample inside the trail column: tiles are positioned by time, so the strip glides by the
 * fraction of `TRAIL_DT` elapsed since the last sample rather than jumping per sample.
 *
 * @param sampleT - Frame time of the sample.
 * @param now - Current frame time.
 * @param x0 - Column left edge.
 * @param w - Column width.
 * @returns x in CSS px (may be left of `x0` once the sample ages out).
 */
export function trailX(sampleT: number, now: number, x0: number, w: number): number {
  return x0 + ((sampleT - (now - TRAIL_MS)) / TRAIL_MS) * w;
}

/** v4 `persistence`: saturation ramps over 20 s from first sight. */
export function persistence(row: FrameRow, t: number): number {
  return Math.min(1, (t - row.first) / PERSISTENCE_MS);
}

/** v4 `heatColour`: side colour blended toward hot above 85 % of the ruler max, alpha by size and persistence. */
export function heatColour(
  row: FrameRow,
  side: "bid" | "ask",
  maxSz: number,
  t: number,
): { readonly c: readonly [number, number, number]; readonly a: number } {
  const c = sideColour(side);
  const sat = 0.35 + 0.65 * persistence(row, t);
  const rel = row.shown / maxSz;
  const hot = rel > 0.85 ? (rel - 0.85) / 0.15 : 0;
  const blended: readonly [number, number, number] =
    hot > 0
      ? [
          c[0] + (PALETTE.hot[0] - c[0]) * hot,
          c[1] + (PALETTE.hot[1] - c[1]) * hot,
          c[2] + (PALETTE.hot[2] - c[2]) * hot,
        ]
      : c;
  return { c: blended, a: (0.15 + 0.85 * rel ** 0.7) * sat };
}

/**
 * The row whose band contains a canvas y, or `undefined` above/below the ladder.
 *
 * @param rows - Frame rows, each carrying its band top.
 * @param y - Canvas y in CSS px.
 * @returns The row under the pointer.
 */
export function rowAtY(rows: ReadonlyArray<FrameRow>, y: number): FrameRow | undefined {
  return rows.find((r) => y >= r.y && y < r.y + ROW);
}

/**
 * Paint the ladder for one frame.
 *
 * @param d - Draw context (canvas, geometry, toggles).
 * @param S - The frame sample.
 */
export function drawLadder(d: DrawContext, S: FrameSample): void {
  const { ctx } = d;
  const X = ladderLayout(d.width, d.trailsOn, d.tapeOn);
  const W = d.width;
  const CH = d.height;
  drawProfile(ctx, S, X, CH);
  // Hover is painted on the canvas: there are no DOM rows to style, and a
  // highlight under the content keeps the row readable (spec, story 41).
  const hovered = d.hoverY === undefined ? undefined : rowAtY(S.rows, d.hoverY);
  if (hovered !== undefined) {
    ctx.fillStyle = rgba(PALETTE.white, 0.06);
    ctx.fillRect(0, hovered.y, X.ladderW, ROW);
    ctx.fillStyle = rgba(PALETTE.white, 0.35);
    ctx.fillRect(0, hovered.y, 2, ROW);
  }
  for (const row of S.rows) {
    const y = row.y;
    const cy = y + ROW / 2;
    const label = Tick.formatOnGrid(row.px, d.scale, d.gridTick);
    if (row.side === "spread") {
      ctx.fillStyle = rgba(PALETTE.mid, 0.05);
      ctx.fillRect(0, y, W, ROW);
      text(ctx, label, X.px, cy, PALETTE.dim, "right");
      continue;
    }
    const round = isRound(row.px, d.gridTick);
    if (row.shown < 1e-6 && row.pulses.length === 0) {
      text(ctx, label, X.px, cy, round ? PALETTE.text : PALETTE.dim, "right", 12, round);
      continue;
    }
    const c = sideColour(row.side);
    const h = heatColour(row, row.side, S.maxSz, S.t);
    ctx.globalAlpha = row.inRuler ? 1 : RULER_DIM;
    ctx.fillStyle = rgba(h.c, h.a);
    ctx.fillRect(X.heat, y + 2, 14, ROW - 4);
    const w = (row.shown / S.maxSz) * X.blockW;
    ctx.fillStyle = rgba(h.c, 0.22 + 0.5 * persistence(row, S.t));
    ctx.fillRect(X.block, y + 3, w, ROW - 6);
    const ps = pulseState(row.pulses, S.t);
    if (ps.ghost > 0) {
      ctx.fillStyle = rgba(c, 0.25 * ps.ghost);
      ctx.fillRect(X.block + w, y + 3, Math.max(0, ((row.prev - row.live) / S.maxSz) * X.blockW), ROW - 6);
    }
    if (ps.add > 0) {
      ctx.strokeStyle = rgba(PALETTE.white, 0.8 * ps.add);
      ctx.lineWidth = 1;
      ctx.strokeRect(X.block + 0.5, y + 3.5, Math.max(w, 2), ROW - 7);
    }
    if (ps.fill > 0) {
      ctx.fillStyle = rgba(PALETTE.white, 0.55 * ps.fill);
      ctx.fillRect(X.heat - 6, y + 2, 4, ROW - 4);
      ctx.fillStyle = rgba(PALETTE.hot, 0.35 * ps.fill);
      ctx.fillRect(0, y, W, ROW);
    }
    if (ps.grew > 0) {
      ctx.fillStyle = rgba(c, 0.12 * ps.grew);
      ctx.fillRect(X.block, y, X.blockW, ROW);
    }
    if (d.overlaysOn) drawRowOverlays(ctx, row, X, S, d);
    text(ctx, label, X.px, cy, round ? PALETTE.text : rgba(c, 0.9), "right", 12, round);
    if (d.trailsOn) {
      const lx = X.block + w + 6;
      const lbl = formatSize(row.shown);
      ctx.font = `11px ${FONT}`;
      const tw = ctx.measureText(lbl).width;
      ctx.fillStyle = "#0b0e11cc";
      ctx.fillRect(lx - 2, y + 5, tw + 4, ROW - 10);
      text(ctx, lbl, lx, cy, PALETTE.text, "left", 11);
      trailStrip(ctx, row, X.trail, X.trailW, y, S);
    } else {
      text(ctx, formatSize(row.shown), X.size, cy, PALETTE.text, "right");
    }
    ctx.globalAlpha = 1;
  }
  if (d.trailsOn) {
    ctx.fillStyle = "#ffffff18";
    ctx.fillRect(X.trail, 0, 1, CH);
    ctx.fillRect(X.trail + X.trailW, 0, 1, CH);
    drawTouchPaths(ctx, S, X, CH, d.scale);
  }
  drawRuler(ctx, S, X, W);
  if (d.overlaysOn) drawMigrations(ctx, S, X, d);
  drawBoundary(ctx, S, X, d);
}

/**
 * v4's per-row overlays: the size-delta strip (sign = pressure direction) and
 * the resiliency bar refilling toward 80 % of the level's pre-loss size.
 */
function drawRowOverlays(
  ctx: CanvasRenderingContext2D,
  row: FrameRow,
  X: LadderLayout,
  S: FrameSample,
  d: DrawContext,
): void {
  if (row.side === "spread") return;
  const f = row.field / S.maxField;
  if (Math.abs(f) > 0.03) {
    const up = (row.side === "bid") === f > 0;
    const fx = d.trailsOn ? X.lane : X.block - 8;
    ctx.fillStyle = rgba(up ? PALETTE.bid : PALETTE.ask, 0.6 * Math.min(1, Math.abs(f)));
    ctx.fillRect(fx, row.y + 3, 4, ROW - 6);
  }
  const w = row.watch;
  if (w === undefined) return;
  const target = 0.8 * w.before;
  const frac = Math.min(1, row.live / target);
  const capped = w.done === Number.POSITIVE_INFINITY;
  const done = w.done !== undefined && !capped;
  const bw = (target / S.maxSz) * X.blockW;
  ctx.fillStyle = "#ffffff14";
  ctx.fillRect(X.block, row.y + ROW - 5, bw, 2);
  ctx.fillStyle = capped ? rgba(PALETTE.hot, 0.9) : done ? rgba(PALETTE.bid, 0.9) : rgba(PALETTE.white, 0.7);
  ctx.fillRect(X.block, row.y + ROW - 5, bw * frac, 2);
}

/** v4's migration connectors: a dashed link between the old and new row, decaying over 600 ms. */
function drawMigrations(ctx: CanvasRenderingContext2D, S: FrameSample, X: LadderLayout, d: DrawContext): void {
  const x = d.trailsOn ? X.lane + 2 : X.block - 14;
  for (const m of S.migrations) {
    const from = S.rows.find((r) => r.px === m.from);
    const to = S.rows.find((r) => r.px === m.to);
    if (from === undefined || to === undefined) continue;
    const a = Math.exp(-(S.t - m.t) / 600);
    const c = sideColour(m.side);
    ctx.strokeStyle = rgba(c, 0.9 * a);
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(x, from.y + ROW / 2);
    ctx.lineTo(x, to.y + ROW / 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = rgba(c, 0.9 * a);
    ctx.beginPath();
    ctx.arc(x, to.y + ROW / 2, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** v4 `trailStrip`: one tile per sample, positioned by time so the strip glides; fill dots at trade times. */
function trailStrip(
  ctx: CanvasRenderingContext2D,
  row: FrameRow,
  x0: number,
  w: number,
  y: number,
  S: FrameSample,
): void {
  if (row.side === "spread") return;
  const cw = (w * TRAIL_DT) / TRAIL_MS;
  const x1 = x0 + w;
  const sat = 0.35 + 0.65 * persistence(row, S.t);
  for (const s of row.trail) {
    const x = trailX(s.t, S.t, x0, w);
    if (x < x0) continue;
    const rel = s.sz / S.maxSz;
    if (rel <= 0) continue;
    const cx0 = Math.max(x0, x);
    const cx1 = Math.min(x1, x + Math.max(2, cw));
    if (cx1 <= cx0) continue;
    // dimmed so the bid/ask paths keep ≥ 3:1 contrast over tiles
    ctx.fillStyle = rgba(rel > 0.85 ? PALETTE.hot : sideColour(row.side), (0.06 + 0.42 * rel ** 0.7) * sat);
    ctx.fillRect(cx0, y + 3, cx1 - cx0, ROW - 6);
  }
  for (const p of row.pulses) {
    if (p.kind !== "fill") continue;
    const x = trailX(p.t0, S.t, x0, w);
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(x, y + ROW / 2, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * y of a price by interpolating between the rows around it (v4 `yOf`), so a
 * BBO finer than the grid sits between rows.
 *
 * @param rows - The frame's rows, top to bottom.
 * @param px - Price in raw ticks.
 * @returns Vertical centre in CSS px, or −100 with no rows.
 */
export function yOf(rows: ReadonlyArray<FrameRow>, px: number): number {
  let above: FrameRow | undefined;
  let below: FrameRow | undefined;
  for (const r of rows) {
    if (r.px >= px) above = r;
    else if (below === undefined) below = r;
  }
  if (above !== undefined && below !== undefined) {
    const f = (above.px - px) / (above.px - below.px);
    return above.y + ROW / 2 + f * (below.y - above.y);
  }
  if (above !== undefined) return above.y + ROW / 2;
  if (below !== undefined) return below.y + ROW / 2;
  return -100;
}

/** Best bid / best ask paths over the trails window with price tags at the "now" edge. */
function drawTouchPaths(
  ctx: CanvasRenderingContext2D,
  S: FrameSample,
  X: LadderLayout,
  CH: number,
  scale: PriceScale,
): void {
  if (S.midTrail.length < 2) return;
  const sides = [
    { key: "a", c: PALETTE.ask, now: S.bestAsk, dy: -7 },
    { key: "b", c: PALETTE.bid, now: S.bestBid, dy: 7 },
  ] as const;
  ctx.save();
  ctx.beginPath();
  ctx.rect(X.trail, 0, X.trailW, CH);
  ctx.clip();
  for (const side of sides) {
    ctx.beginPath();
    S.midTrail.forEach((s, i) => {
      const x = trailX(s.t, S.t, X.trail, X.trailW);
      const yy = yOf(S.rows, s[side.key]);
      if (i === 0) ctx.moveTo(x, yy);
      else ctx.lineTo(x, yy);
    });
    ctx.lineTo(X.trail + X.trailW, yOf(S.rows, side.now));
    ctx.strokeStyle = rgba(side.c, 0.22);
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.strokeStyle = rgba(side.c, 0.95);
    ctx.lineWidth = 1.25;
    ctx.stroke();
  }
  ctx.restore();
  // Without a BBO the bests are grouped book rows; a price tag would misreport the touch.
  if (!S.rawTouch) return;
  for (const side of sides) {
    const yy = yOf(S.rows, side.now);
    pill(ctx, Tick.format(side.now, scale), X.trail + X.trailW - 1, yy + side.dy, "right", rgba(side.c, 0.95), 9, 12);
  }
}

/** v4 `ribbon1`: 1 px boundary line, last-trade tag on the price column, stacked share bar in the gutter. */
function drawBoundary(ctx: CanvasRenderingContext2D, S: FrameSample, X: LadderLayout, d: DrawContext): void {
  const y = S.ribY;
  ctx.fillStyle = rgba(PALETTE.mid, 0.7);
  ctx.fillRect(0, y - 0.5, X.ladderW, 1);
  const last = S.lastTrade;
  const lastPx = last?.px ?? S.mid;
  const ty = tagY(S, lastPx, d.gridTick);
  const lc: Rgb =
    last === undefined ? PALETTE.mid : last.dir > 0 ? PALETTE.bid : last.dir < 0 ? PALETTE.ask : PALETTE.neutral;
  const lbl = last === undefined ? Tick.formatMid(S.mid, d.scale) : Tick.format(last.px, d.scale);
  pill(ctx, lbl, X.px, ty, "right", rgba(lc, 0.95), 12, 18, last?.dir ?? 0);
  // stacked share bar: ask part above the boundary, bid part below (height ∝ share), sizes beside
  const bx = X.block + X.blockW + 34;
  const bw = 10;
  const H = 44;
  const hb = S.share * H;
  const ha = H - hb;
  ctx.fillStyle = rgba(PALETTE.ask, 0.8);
  ctx.fillRect(bx, y - ha, bw, ha);
  ctx.fillStyle = rgba(PALETTE.bid, 0.8);
  ctx.fillRect(bx, y, bw, hb);
  ctx.fillStyle = "#fff";
  ctx.fillRect(bx - 2, y - 1, bw + 4, 2);
  text(ctx, formatSize(S.bestAskSz), bx + bw + 6, y - ha / 2, rgba(PALETTE.ask, 1), "left", 10, true);
  text(ctx, formatSize(S.bestBidSz), bx + bw + 6, y + hb / 2, rgba(PALETTE.bid, 1), "left", 10, true);
}

/** Stepped cumulative profile behind the block column, per side. */
function drawProfile(ctx: CanvasRenderingContext2D, S: FrameSample, X: LadderLayout, CH: number): void {
  const P0 = X.block;
  const PW = X.blockW;
  for (const side of ["ask", "bid"] as const) {
    const c = sideColour(side);
    ctx.beginPath();
    let started = false;
    for (const row of S.rows) {
      if (row.side !== side) continue;
      const w = P0 + (row.cum / S.maxCum) * PW;
      if (!started) {
        ctx.moveTo(P0, row.y);
        started = true;
      }
      ctx.lineTo(w, row.y);
      ctx.lineTo(w, row.y + ROW);
    }
    ctx.lineTo(P0, side === "ask" ? S.ribY : CH);
    ctx.closePath();
    const g = ctx.createLinearGradient(P0, 0, P0 + PW, 0);
    g.addColorStop(0, rgba(c, 0.18));
    g.addColorStop(1, rgba(c, 0.03));
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = rgba(c, 0.5);
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

/** Ruler lines with the cumulative size at each edge row. */
function drawRuler(ctx: CanvasRenderingContext2D, S: FrameSample, X: LadderLayout, W: number): void {
  for (const [k, yy] of S.rulerY.entries()) {
    ctx.fillStyle = "#ffffff30";
    ctx.fillRect(0, Math.round(yy), W, 1);
    const edgeY = k === 0 ? yy : yy - ROW;
    const rr = S.rows.find((r) => r.y === edgeY);
    if (rr !== undefined && rr.cum > 0)
      text(ctx, `Σ ${formatSize(rr.cum)}`, X.block + X.blockW + 8, yy + (k === 0 ? 8 : -8), PALETTE.dim);
  }
}

/**
 * Vertical centre for the last-trade tag: its own row when the price is on
 * screen, otherwise the nearest row centre. v4 fell back to `S.ribY`, a row
 * *top*, which left the pill straddling two rows whenever the print sat
 * outside the window (ADR 0009 amendment).
 *
 * @param S - The frame sample.
 * @param px - Price to tag, in raw ticks.
 * @param gridTick - Row step in raw ticks.
 * @returns y of the tag's centre in CSS px.
 */
export function tagY(S: FrameSample, px: number, gridTick: number): number {
  const exact = S.rows.find((r) => Math.abs(r.px - px) < gridTick / 2 + 1e-9);
  if (exact !== undefined) return exact.y + ROW / 2;
  const first = S.rows[0];
  const last = S.rows[S.rows.length - 1];
  if (first === undefined || last === undefined) return S.ribY;
  const clamped = px > first.px ? first : px < last.px ? last : undefined;
  return clamped === undefined ? S.ribY : clamped.y + ROW / 2;
}

/**
 * v4 `isRound`: multiples of ten grid steps are emphasised.
 *
 * @param px - Row price in raw ticks.
 * @param gridTick - Row step in raw ticks.
 * @returns True when the price is a round number on this grid.
 */
export function isRound(px: number, gridTick: number): boolean {
  return px % (gridTick * 10) === 0;
}
