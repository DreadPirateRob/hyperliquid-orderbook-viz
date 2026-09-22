import type { Metrics } from "../data/engine-api.types";
import { FONT, PALETTE, rgba } from "./palette";

/**
 * v4's `drawShapePanel`: cumulative depth curves for both sides with their
 * convexity, drawn on the HUD's own small canvas.
 */

const W = 240;
const H = 90;

/**
 * Paint the book-shape sparkline.
 *
 * @param canvas - The HUD's shape canvas.
 * @param metrics - Current metrics, or `undefined` to clear.
 */
export function drawShapePanel(canvas: HTMLCanvasElement, metrics: Metrics | undefined): void {
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(W * dpr)) {
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  }
  const g = canvas.getContext("2d");
  if (g === null) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  g.font = `600 9px ${FONT}`;
  g.fillStyle = PALETTE.dim;
  g.textAlign = "left";
  g.textBaseline = "middle";
  g.fillText("BOOK SHAPE", 10, 9);
  if (metrics === undefined) return;
  const panelW = W - 70;
  const panelH = (H - 24) / 2;
  const maxAll = Math.max(metrics.ask.shape.at(-1) ?? 1, metrics.bid.shape.at(-1) ?? 1, 1);
  const sides = [
    { curve: metrics.ask.shape, colour: PALETTE.ask, base: 16, up: true, convexity: metrics.ask.convexity },
    {
      curve: metrics.bid.shape,
      colour: PALETTE.bid,
      base: 16 + panelH + 2,
      up: false,
      convexity: metrics.bid.convexity,
    },
  ];
  for (const side of sides) {
    if (side.curve.length === 0) continue;
    g.beginPath();
    side.curve.forEach((v, i) => {
      const x = 10 + (i / Math.max(1, side.curve.length - 1)) * panelW;
      const y = side.up ? side.base + panelH - (v / maxAll) * panelH : side.base + (v / maxAll) * panelH;
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    });
    g.strokeStyle = rgba(side.colour, 0.9);
    g.lineWidth = 1.5;
    g.stroke();
    g.lineTo(10 + panelW, side.up ? side.base + panelH : side.base);
    g.lineTo(10, side.up ? side.base + panelH : side.base);
    g.closePath();
    g.fillStyle = rgba(side.colour, 0.12);
    g.fill();
    g.fillStyle = rgba(side.colour, 1);
    g.fillText(
      `cvx ${side.convexity === undefined ? "–" : side.convexity.toFixed(2)}`,
      10 + panelW + 6,
      side.base + panelH / 2,
    );
  }
}
