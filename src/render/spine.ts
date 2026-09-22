import * as Tick from "../domain/tick";
import type { FrameSample } from "../state/frame-sample.types";
import { ROW } from "../state/sampler";
import type { DrawContext } from "./draw.types";
import { heatColour, isRound, pulseState, tagY } from "./ladder";
import { FONT, PALETTE, formatSize, pill, rgba, sideColour, text } from "./palette";
import { TAPE_W } from "./tape";

/**
 * v4's `drawSpine`: prices in a central column, depth growing outward — asks
 * right, bids left. No trails and no tape (the spine is the narrow reading).
 */

/** Distance from the centre where bars start, and the widest half (v4). */
const GAP = 60;
const MAX_HALF = 420;

/** Spine geometry for a width. */
export type SpineLayout = {
  /** Width the spine occupies (the tape column is not reserved). */
  readonly width: number;
  /** Centre column x. */
  readonly cx: number;
  /** Where bars start, either side of the centre. */
  readonly gap: number;
  /** Longest bar, in CSS px. */
  readonly barMax: number;
};

/**
 * v4's spine geometry: centred column, bars from ±60 out to at most 420 px.
 *
 * @param width - Canvas width in CSS px.
 * @returns Centre and bar extents.
 */
export function spineLayout(width: number): SpineLayout {
  const cx = Math.round(width / 2);
  const half = Math.min(MAX_HALF, cx - GAP);
  return { width, cx, gap: GAP, barMax: half - GAP };
}

/**
 * Paint the centre-spine view.
 *
 * @param d - Draw context.
 * @param S - The frame sample.
 */
export function drawSpine(d: DrawContext, S: FrameSample): void {
  const { ctx } = d;
  const { width: W, cx, gap, barMax } = spineLayout(d.tapeOn ? d.width - TAPE_W : d.width);
  drawProfiles(ctx, S, cx, gap, barMax, d.height);
  for (const row of S.rows) {
    const y = row.y;
    const cy = y + ROW / 2;
    const label = Tick.formatOnGrid(row.px, d.scale, d.gridTick);
    if (row.side === "spread") {
      ctx.fillStyle = rgba(PALETTE.mid, 0.05);
      ctx.fillRect(0, y, W, ROW);
      text(ctx, label, cx, cy, PALETTE.dim, "center");
      continue;
    }
    ctx.globalAlpha = row.inRuler ? 1 : 0.45;
    const c = sideColour(row.side);
    const dir = row.side === "bid" ? -1 : 1;
    const round = isRound(row.px, d.gridTick);
    text(ctx, label, cx, cy, round ? PALETTE.text : rgba(c, 0.85), "center", 12, round);
    if (row.shown < 1e-6 && row.pulses.length === 0) {
      ctx.globalAlpha = 1;
      continue;
    }
    const ps = pulseState(row.pulses, S.t);
    const h = heatColour(row, row.side, S.maxSz, S.t);
    const w = (row.shown / S.maxSz) * barMax;
    const x0 = cx + dir * gap;
    ctx.fillStyle = rgba(h.c, h.a);
    ctx.fillRect(dir < 0 ? x0 - w : x0, y + 3, w, ROW - 6);
    if (ps.ghost > 0) {
      const gw = Math.max(0, ((row.prev - row.live) / S.maxSz) * barMax);
      ctx.fillStyle = rgba(c, 0.2 * ps.ghost);
      ctx.fillRect(dir < 0 ? x0 - w - gw : x0 + w, y + 3, gw, ROW - 6);
    }
    if (ps.add > 0) {
      ctx.strokeStyle = rgba(PALETTE.white, 0.8 * ps.add);
      ctx.lineWidth = 1;
      ctx.strokeRect((dir < 0 ? x0 - w : x0) + 0.5, y + 3.5, Math.max(w, 2), ROW - 7);
    }
    if (ps.fill > 0) {
      ctx.fillStyle = rgba(PALETTE.white, 0.6 * ps.fill);
      ctx.fillRect(cx + dir * 52, y + 2, 4, ROW - 4);
      ctx.fillStyle = rgba(PALETTE.hot, 0.3 * ps.fill);
      ctx.fillRect(dir < 0 ? 0 : cx, y, cx, ROW);
    }
    // At phone widths a bar can reach the edge; the size stays legible inside it.
    const sizeLabel = formatSize(row.shown);
    ctx.font = `11px ${FONT}`;
    const tw = ctx.measureText(sizeLabel).width;
    const rawX = dir < 0 ? x0 - w - 6 : x0 + w + 6;
    const labelX = dir < 0 ? Math.max(tw + 4, rawX) : Math.min(W - tw - 4, rawX);
    text(ctx, sizeLabel, labelX, cy, PALETTE.text, dir < 0 ? "right" : "left", 11);
    ctx.globalAlpha = 1;
  }
  for (const yy of S.rulerY) {
    ctx.fillStyle = "#ffffff30";
    ctx.fillRect(0, Math.round(yy), W, 1);
  }
  drawSpineBoundary(ctx, S, cx, W, d);
}

/** Mirrored cumulative profiles growing outward from the spine. */
function drawProfiles(
  ctx: CanvasRenderingContext2D,
  S: FrameSample,
  cx: number,
  gap: number,
  barMax: number,
  CH: number,
): void {
  for (const side of ["ask", "bid"] as const) {
    const c = sideColour(side);
    const dir = side === "bid" ? -1 : 1;
    ctx.beginPath();
    let started = false;
    for (const row of S.rows) {
      if (row.side !== side) continue;
      const w = cx + dir * (gap + (row.cum / S.maxCum) * barMax);
      if (!started) {
        ctx.moveTo(cx + dir * gap, row.y);
        started = true;
      }
      ctx.lineTo(w, row.y);
      ctx.lineTo(w, row.y + ROW);
    }
    ctx.lineTo(cx + dir * gap, side === "ask" ? S.ribY : CH);
    ctx.closePath();
    ctx.fillStyle = rgba(c, 0.07);
    ctx.fill();
    ctx.strokeStyle = rgba(c, 0.45);
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

/** v4's `ribbon1` in spine geometry: boundary line, last-trade tag centred, share bar left of the spine. */
function drawSpineBoundary(ctx: CanvasRenderingContext2D, S: FrameSample, cx: number, W: number, d: DrawContext): void {
  const y = S.ribY;
  ctx.fillStyle = rgba(PALETTE.mid, 0.7);
  ctx.fillRect(0, y - 0.5, W, 1);
  const last = S.lastTrade;
  const lastPx = last?.px ?? S.mid;
  const ty = tagY(S, lastPx, d.gridTick);
  const colour =
    last === undefined ? PALETTE.mid : last.dir > 0 ? PALETTE.bid : last.dir < 0 ? PALETTE.ask : PALETTE.neutral;
  const lbl = last === undefined ? Tick.formatMid(S.mid, d.scale) : Tick.format(last.px, d.scale);
  // v4's ribbon1 always right-aligns the tag at its anchor (it ignores the `pxAlign` it is handed),
  // so the pill ends at cx + 30 and covers the centred row price rather than leaving digits exposed.
  pill(ctx, lbl, cx + 30, ty, "right", rgba(colour, 0.95), 12, 18, last?.dir ?? 0);
  const bx = cx - 300;
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
