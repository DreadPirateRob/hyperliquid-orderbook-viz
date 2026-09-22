import * as Tick from "../domain/tick";
import type { FrameSample } from "../state/frame-sample.types";
import type { DrawContext } from "./draw.types";
import { PALETTE, directionMark, formatSize, rgba, text } from "./palette";

/**
 * v4's `drawTape`: the prints column on the right. Rows fade over a minute,
 * flash on arrival, and outliers (≥ P95) burn amber.
 */

/** Column width (v4 `TAPE_W`). */
export const TAPE_W = 200;
const ROW_H = 18;
/** Enter flash decay and the age fade floor/window (v4). */
const ENTER_TAU = 350;
const FADE_MS = 60_000;
const FADE_FLOOR = 0.35;

/**
 * Paint the tape column.
 *
 * @param d - Draw context.
 * @param S - The frame sample.
 */
export function drawTape(d: DrawContext, S: FrameSample): void {
  const { ctx } = d;
  const x0 = d.width - TAPE_W;
  let maxSz = 0;
  for (const r of S.tape) if (r.sz > maxSz) maxSz = r.sz;
  ctx.fillStyle = "#0d1117";
  ctx.fillRect(x0, 0, TAPE_W, d.height);
  ctx.fillStyle = "#ffffff18";
  ctx.fillRect(x0, 0, 1, d.height);
  const cAge = x0 + 10;
  const cPx = x0 + 44;
  const cSz = x0 + TAPE_W - 10;
  text(ctx, "age", cAge, 12, PALETTE.dim, "left", 9, true);
  text(ctx, "price", cPx + 14, 12, PALETTE.dim, "left", 9, true);
  text(ctx, "size", cSz, 12, PALETTE.dim, "right", 9, true);
  let y = 24;
  for (const r of S.tape) {
    if (y > d.height - ROW_H) break;
    const age = (S.t - r.rx) / 1000;
    const c = r.side === "B" ? PALETTE.bid : PALETTE.ask;
    const hot = r.sz >= S.tapeOutlier;
    const colour = hot ? PALETTE.hot : c;
    const rel = r.sz / (maxSz || 1);
    ctx.globalAlpha = Math.max(FADE_FLOOR, 1 - (S.t - r.rx) / FADE_MS);
    const enter = Math.exp(-(S.t - r.rx) / ENTER_TAU);
    if (enter > 0.02) {
      ctx.fillStyle = rgba(colour, 0.35 * enter);
      ctx.fillRect(x0 + 1, y, TAPE_W - 1, ROW_H);
    }
    ctx.fillStyle = rgba(colour, 0.18 + 0.25 * rel);
    ctx.fillRect(x0 + TAPE_W - 8 - 60 * rel, y + 4, 60 * rel, ROW_H - 8);
    text(ctx, formatAge(age), cAge, y + ROW_H / 2, PALETTE.dim, "left", 10);
    // v4 draws an arrow glyph here; the widget uses no glyph characters, so the mark is a path
    // and the price keeps its column whether or not the print moved.
    if (r.dir !== 0) directionMark(ctx, cPx, y + ROW_H / 2, 7, r.dir > 0, rgba(colour, 1));
    text(ctx, Tick.format(r.px, d.scale), cPx + 11, y + ROW_H / 2, rgba(colour, 1), "left", 11, hot);
    const size = `${formatSize(r.sz)}${r.n > 1 ? ` x${r.n}` : ""}`;
    text(ctx, size, cSz, y + ROW_H / 2, hot ? rgba(PALETTE.hot, 1) : PALETTE.text, "right", 11, hot);
    ctx.globalAlpha = 1;
    y += ROW_H;
  }
}

/** v4's age column: `now`, `12s`, `3m`. */
function formatAge(age: number): string {
  if (age < 1) return "now";
  return age < 60 ? `${age.toFixed(0)}s` : `${(age / 60).toFixed(0)}m`;
}
