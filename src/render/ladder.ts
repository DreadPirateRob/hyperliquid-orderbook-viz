import * as Tick from "../domain/tick";
import type { FrameRow, FrameSample } from "../state/frame-sample.types";
import { ROW } from "../state/sampler";
import type { DrawContext } from "./draw.types";
import { PALETTE, formatSize, rgba, sideColour, text } from "./palette";

/**
 * v4's `drawLadder`: the classic ladder view. This module carries the static
 * parts — profile, heat cell, block, labels, ruler; pulses, trails, overlays
 * and the boundary arrive with their tickets.
 */

/** v4 layout constants. */
const BLOCK_W = 300;
const GUTTER_W = 170;
const TAPE_W = 200;
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
    return { px, heat, lane: heat + 18, block, blockW: BLOCK_W, size: 0, trail, trailW: Math.max(120, px - 150 - trail), ladderW };
  }
  return { px: 90, heat: 110, lane: 130, block: 230, blockW: Math.min(360, ladderW - 230 - 260), size: 200, trail: 215, trailW: 0, ladderW };
}

/** v4 `persistence`: saturation ramps over 20 s from first sight. */
export function persistence(row: FrameRow, t: number): number {
  return Math.min(1, (t - row.first) / PERSISTENCE_MS);
}

/** v4 `heatColour`: side colour blended toward hot above 85 % of the ruler max, alpha by size and persistence. */
export function heatColour(row: FrameRow, side: "bid" | "ask", maxSz: number, t: number): { readonly c: readonly [number, number, number]; readonly a: number } {
  const c = sideColour(side);
  const sat = 0.35 + 0.65 * persistence(row, t);
  const rel = row.shown / maxSz;
  const hot = rel > 0.85 ? (rel - 0.85) / 0.15 : 0;
  const blended: readonly [number, number, number] =
    hot > 0 ? [c[0] + (PALETTE.hot[0] - c[0]) * hot, c[1] + (PALETTE.hot[1] - c[1]) * hot, c[2] + (PALETTE.hot[2] - c[2]) * hot] : c;
  return { c: blended, a: (0.15 + 0.85 * rel ** 0.7) * sat };
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
    text(ctx, label, X.px, cy, round ? PALETTE.text : rgba(c, 0.9), "right", 12, round);
    if (d.trailsOn) {
      const lx = X.block + w + 6;
      const lbl = formatSize(row.shown);
      ctx.font = `11px ui-monospace,Menlo,monospace`;
      const tw = ctx.measureText(lbl).width;
      ctx.fillStyle = "#0b0e11cc";
      ctx.fillRect(lx - 2, y + 5, tw + 4, ROW - 10);
      text(ctx, lbl, lx, cy, PALETTE.text, "left", 11);
    } else {
      text(ctx, formatSize(row.shown), X.size, cy, PALETTE.text, "right");
    }
    ctx.globalAlpha = 1;
  }
  if (d.trailsOn) {
    ctx.fillStyle = "#ffffff18";
    ctx.fillRect(X.trail, 0, 1, CH);
    ctx.fillRect(X.trail + X.trailW, 0, 1, CH);
  }
  drawRuler(ctx, S, X, W);
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
    if (rr !== undefined && rr.cum > 0) text(ctx, `Σ ${formatSize(rr.cum)}`, X.block + X.blockW + 8, yy + (k === 0 ? 8 : -8), PALETTE.dim);
  }
}

/** v4 `isRound`: multiples of ten grid steps are emphasised. */
function isRound(px: number, gridTick: number): boolean {
  return px % (gridTick * 10) === 0;
}
