import { expect, test } from "@playwright/test";
import { ladderLayout } from "../src/render/ladder";

/**
 * Seam 1: the widget entrypoint with an injected fixture feed. The demo's
 * `?fixture=` wires `createFixtureFeed` into `<OrderBook feed>`; the test
 * observes only what a user sees: connection state, mid, grouping, pixels.
 */
test("BTC recording reaches LIVE and paints ladder rows", async ({ page }) => {
  await page.goto("/?fixture=btc-perp-active&speed=4");
  const root = page.locator(".orderbook");
  await expect(root).toHaveAttribute("data-feed", "injected");
  await expect(root).toHaveAttribute("data-connection", "LIVE", { timeout: 20_000 });
  await expect(page.locator(".orderbook-mid")).toHaveText(/^8\d{4}(\.\d)?$/);
  await expect(page.locator(".orderbook-group")).toHaveText("$1");

  const layout = ladderLayout(1500, true, true);
  const painted = await page.locator("canvas.orderbook-canvas").evaluate((el, X) => {
    if (!(el instanceof HTMLCanvasElement)) return { bidRows: 0, askRows: 0, labels: 0 };
    const canvas = el;
    const ctx = canvas.getContext("2d");
    if (ctx === null) return { bidRows: 0, askRows: 0, labels: 0 };
    const dpr = window.devicePixelRatio || 1;
    const rowH = 22;
    const rows = Math.floor(canvas.height / dpr / rowH);
    const blockX = X.block + 4;
    const priceX = X.px - 20;
    let bidRows = 0;
    let askRows = 0;
    let labels = 0;
    for (let i = 0; i < rows; i++) {
      const y = i * rowH + rowH / 2;
      const [r, g, b] = ctx.getImageData(Math.round(blockX * dpr), Math.round(y * dpr), 1, 1).data;
      if (g !== undefined && r !== undefined && b !== undefined && g > r + 20 && g > 40) bidRows++;
      if (r !== undefined && g !== undefined && r > g + 20 && r > 40) askRows++;
      const px = ctx.getImageData(Math.round(priceX * dpr), Math.round(y * dpr), 1, 1).data;
      if ((px[0] ?? 0) + (px[1] ?? 0) + (px[2] ?? 0) > 150) labels++;
    }
    return { bidRows, askRows, labels };
  }, layout);
  expect(painted.bidRows).toBeGreaterThan(2);
  expect(painted.askRows).toBeGreaterThan(2);
  expect(painted.labels).toBeGreaterThan(5);
});

test("the live entrypoint mounts and starts connecting", async ({ page }) => {
  await page.goto("/?coin=BTC");
  const root = page.locator(".orderbook");
  await expect(root).toHaveAttribute("data-feed", "live");
  await expect(root).toHaveAttribute("data-coin", "BTC");
});
