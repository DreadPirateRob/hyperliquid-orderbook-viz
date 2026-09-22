/** v4's palette (ADR 0009). Changing any value requires an ADR amendment. */
export const PALETTE = {
  bg: "#0b0e11",
  text: "#e5e7eb",
  dim: "#6b7280",
  bid: [45, 212, 191],
  ask: [251, 113, 133],
  hot: [251, 191, 36],
  mid: [96, 165, 250],
  white: [255, 255, 255],
  /** Last-trade tag when the print did not move (v4 literal). */
  neutral: [200, 200, 200],
} as const;

/** An RGB triple. */
export type Rgb = readonly [number, number, number];

/** `rgba()` string for a triple at alpha `a`. */
export function rgba(c: Rgb, a: number): string {
  return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
}

/** Side colour. */
export function sideColour(side: "bid" | "ask"): Rgb {
  return side === "bid" ? PALETTE.bid : PALETTE.ask;
}

/** v4's monospace stack. */
export const FONT = "ui-monospace,Menlo,monospace";

/**
 * v4's `text()` helper: fill text at a baseline-middle anchor.
 *
 * @param ctx - Canvas context.
 * @param s - The string.
 * @param x - X in CSS px.
 * @param y - Y in CSS px (vertical centre).
 * @param colour - Fill style.
 * @param align - Horizontal alignment.
 * @param size - Font size in px.
 * @param bold - Weight 600 when true.
 */
export function text(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  colour: string,
  align: CanvasTextAlign = "left",
  size = 12,
  bold = false,
): void {
  ctx.fillStyle = colour;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.font = `${bold ? "600 " : ""}${size}px ${FONT}`;
  ctx.fillText(s, x, y);
}

/** v4's `fmtSz`: `1.2k`, `12.3`, `0.123`. */
export function formatSize(sz: number): string {
  return sz >= 1000 ? `${(sz / 1000).toFixed(1)}k` : sz.toFixed(sz < 10 ? 3 : 1);
}

/**
 * Top of a pill box whose glyphs line up with surrounding row text. Canvas
 * `textBaseline: "middle"` centres the em box, which sits above the visual
 * centre of digits, so a geometrically centred box reads low.
 *
 * @param y - Row centre in CSS px (the y the row's text uses).
 * @param ascent - `actualBoundingBoxAscent` of the label.
 * @param descent - `actualBoundingBoxDescent` of the label.
 * @param height - Pill height in px.
 * @returns Box top in CSS px.
 */
export function pillTop(y: number, ascent: number, descent: number, height: number): number {
  return y + (descent - ascent) / 2 - height / 2;
}

/**
 * Draw a rounded pill centred on the *glyphs* of `label`, not on the em box.
 * Canvas `textBaseline: "middle"` centres the em box, which sits above the
 * visual centre of digits, so a geometrically centred box reads low against
 * the surrounding text.
 *
 * @param ctx - Canvas context.
 * @param label - The text to render inside the pill.
 * @param x - Anchor x in CSS px.
 * @param y - Row centre in CSS px (the same y the row's text uses).
 * @param align - Horizontal anchor: pill grows left, centres, or grows right.
 * @param fill - Pill colour.
 * @param size - Font size in px.
 * @param height - Pill height in px.
 */
export function pill(
  ctx: CanvasRenderingContext2D,
  label: string,
  x: number,
  y: number,
  align: "left" | "center" | "right",
  fill: string,
  size = 12,
  height = 18,
): void {
  ctx.font = `600 ${size}px ${FONT}`;
  ctx.textBaseline = "middle";
  const m = ctx.measureText(label);
  const width = m.width + 10;
  const left = align === "right" ? x - width + 4 : align === "center" ? x - width / 2 : x;
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.roundRect(left, pillTop(y, m.actualBoundingBoxAscent, m.actualBoundingBoxDescent, height), width, height, 3);
  ctx.fill();
  const tx = align === "right" ? x - 1 : align === "center" ? x : x + 5;
  text(ctx, label, tx, y, PALETTE.bg, align === "right" ? "right" : align, size, true);
}
