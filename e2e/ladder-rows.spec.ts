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

test("the HUD updates by ref: no React commits at steady state", async ({ page }) => {
  await page.goto("/?fixture=btc-perp-active&speed=4");
  await expect(page.locator(".orderbook")).toHaveAttribute("data-connection", "LIVE", { timeout: 20_000 });
  await page.keyboard.press("m");
  await expect(page.locator(".orderbook")).toHaveAttribute("data-metrics", "1");
  await expect(page.locator(".orderbook-hud pre")).toContainText("PRESSURE", { timeout: 5000 });

  const before = await page.evaluate(
    () => (globalThis as { __obCommits?: { count: number } }).__obCommits?.count ?? -1,
  );
  const hudBefore = await page.locator(".orderbook-hud pre").textContent();
  await page.waitForTimeout(3000);
  const after = await page.evaluate(() => (globalThis as { __obCommits?: { count: number } }).__obCommits?.count ?? -1);
  const hudAfter = await page.locator(".orderbook-hud pre").textContent();

  expect(after).toBe(before);
  expect(hudAfter, "the HUD keeps updating while React is idle").not.toBe(hudBefore);
});

test("overlays and metrics toggle from the keyboard and survive in the URL", async ({ page }) => {
  await page.goto("/?fixture=btc-perp-active&speed=4");
  const root = page.locator(".orderbook");
  await expect(root).toHaveAttribute("data-overlays", "1");
  await page.keyboard.press("o");
  await expect(root).toHaveAttribute("data-overlays", "0");
  await expect(page).toHaveURL(/ovl=0/);
  await page.keyboard.press("o");
  await expect(page).not.toHaveURL(/ovl=0/);
});

test("the metrics panel is absent until asked for and leaves nothing behind", async ({ page }) => {
  await page.goto("/?fixture=btc-perp-active&speed=4");
  await expect(page.locator(".orderbook")).toHaveAttribute("data-connection", "LIVE", { timeout: 20_000 });
  await expect(page.locator(".orderbook-hud")).toHaveCount(0);
  await page.keyboard.press("m");
  await expect(page.locator(".orderbook-hud")).toBeVisible();
  await page.keyboard.press("m");
  await expect(page.locator(".orderbook-hud")).toHaveCount(0);
});

test("grouping steps with the keyboard, resubscribes, and survives in the URL", async ({ page }) => {
  await page.goto("/?fixture=btc-perp-active&speed=4");
  const root = page.locator(".orderbook");
  await expect(root).toHaveAttribute("data-connection", "LIVE", { timeout: 20_000 });
  await expect(page.locator(".orderbook-group")).toHaveText("$1");
  const options = page.locator(".orderbook-group-option");
  await expect(options).toHaveText(["$1", "$2", "$5", "$10", "$100"]);
  await expect(options.nth(0)).toHaveAttribute("aria-pressed", "true");

  await page.keyboard.press("]");
  await expect(page).toHaveURL(/g=20/);
  await expect(options.nth(1)).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("[");
  await expect(page).toHaveURL(/g=10/);
  await expect(options.nth(0)).toHaveAttribute("aria-pressed", "true");
});

test("the pair picker opens with /, filters, and switching coin resets and re-subscribes", async ({ page }) => {
  await page.goto("/?coin=BTC");
  const root = page.locator(".orderbook");
  await expect(root).toHaveAttribute("data-coin", "BTC");
  await page.keyboard.press("/");
  const picker = page.locator(".orderbook-pairpop");
  await expect(picker).toBeVisible();
  await expect(page.locator(".orderbook-pairrow").first()).toBeVisible({ timeout: 15_000 });

  await page.locator(".orderbook-pairsearch").fill("eth");
  const rows = page.locator(".orderbook-pairrow");
  await expect(rows.first()).toContainText("ETH");
  await page.keyboard.press("Enter");

  await expect(picker).toHaveCount(0);
  await expect(root).toHaveAttribute("data-coin", "ETH");
  await expect(page).toHaveURL(/coin=ETH/);
  await expect(root).toHaveAttribute("data-connection", "LIVE", { timeout: 25_000 });
  await expect(page.locator(".orderbook-mid")).toHaveText(/^\d/);
});

test("escape closes the picker and returns focus to its trigger", async ({ page }) => {
  await page.goto("/?fixture=btc-perp-active&speed=4");
  // The fixture demo mounts after the recording loads, so wait for the widget before typing at it.
  await expect(page.locator(".orderbook")).toBeVisible();
  await page.keyboard.press("/");
  await expect(page.locator(".orderbook-pairpop")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".orderbook-pairpop")).toHaveCount(0);
  await expect(page.locator(".orderbook-pair")).toBeFocused();
});

test("a shared link's grouping survives the load", async ({ page }) => {
  await page.goto("/?coin=BTC&g=50");
  const root = page.locator(".orderbook");
  await expect(root).toHaveAttribute("data-connection", "LIVE", { timeout: 25_000 });
  // The request is made before the option list exists, so the runtime must replay it.
  await expect(page.locator(".orderbook-group")).toHaveText("$5", { timeout: 20_000 });
  await expect(page).toHaveURL(/g=50/);
});

test("settings persist across a reload and drive the render cadence", async ({ page }) => {
  await page.goto("/?fixture=btc-perp-active&speed=4");
  await expect(page.locator(".orderbook")).toHaveAttribute("data-connection", "LIVE", { timeout: 20_000 });
  await page.getByLabel("Settings").click();
  const gear = page.getByRole("dialog", { name: "Settings" });
  await expect(gear).toBeVisible();

  await gear.getByRole("combobox").first().selectOption("30");
  await gear.getByRole("slider").fill("20");
  await gear.getByRole("combobox").last().selectOption("1000000");
  await page.keyboard.press("Escape");
  await expect(gear).toHaveCount(0);

  await page.keyboard.press("m");
  await expect(page.locator(".orderbook-hud pre")).toContainText("COST $1M", { timeout: 5000 });
  await expect(page.locator(".orderbook-hud pre")).toContainText(/RENDER\s+3\d\.\d fps/, { timeout: 5000 });

  await page.reload();
  await page.getByLabel("Settings").click();
  await expect(page.getByRole("dialog", { name: "Settings" }).getByRole("slider")).toHaveValue("20");
});
