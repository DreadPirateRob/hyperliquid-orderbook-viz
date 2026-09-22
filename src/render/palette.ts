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
