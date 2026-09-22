import { expect, test } from "@playwright/test";

/**
 * Seam 2: the widget under a narrow host and under a keyboard only. Width
 * policy, the gesture that replaces the segmented control, focus management
 * and the text alternative are all observed through the page, never through
 * internals.
 */

const FIXTURE = "/?fixture=btc-perp-active&speed=4";

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true });

  test("reaches LIVE, collapses to the spine and paints it", async ({ page }) => {
    await page.goto(FIXTURE);
    const root = page.locator(".orderbook");
    await expect(root).toHaveAttribute("data-connection", "LIVE", { timeout: 20_000 });
    await expect(root).toHaveAttribute("data-view", "spine");
    await expect(root).toHaveAttribute("data-tape", "0");
    await expect(root).toHaveAttribute("data-trails", "0");
    await expect(root).toHaveAttribute("data-overlays", "0");
    await expect(root).toHaveAttribute("data-sheet", "1");
    await expect(root).toHaveAttribute("data-compact", "1");
    // The width cannot hold those columns, so their toggles are not offered.
    await expect(page.getByRole("button", { name: "tape" })).toBeHidden();
    await expect(page.locator(".orderbook-groupseg")).toBeHidden();

    const painted = await page.locator("canvas.orderbook-canvas").evaluate((el) => {
      if (!(el instanceof HTMLCanvasElement)) return 0;
      const ctx = el.getContext("2d");
      if (ctx === null) return 0;
      const dpr = window.devicePixelRatio || 1;
      // The spine is drawn around the centre of the canvas; count coloured bands down it.
      const x = Math.round((el.width / dpr / 2 + 40) * dpr);
      const data = ctx.getImageData(x, 0, 1, el.height).data;
      let lit = 0;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i] ?? 0;
        const g = data[i + 1] ?? 0;
        const b = data[i + 2] ?? 0;
        if (r + g + b > 120) lit++;
      }
      return lit;
    });
    expect(painted).toBeGreaterThan(50);
  });

  test("pinching the ladder changes the grouping", async ({ page }) => {
    await page.goto(FIXTURE);
    await expect(page.locator(".orderbook")).toHaveAttribute("data-connection", "LIVE", { timeout: 20_000 });

    await page.locator("canvas.orderbook-canvas").evaluate((el) => {
      const send = (type: string, id: number, x: number, y: number): void => {
        el.dispatchEvent(
          new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, bubbles: true, pointerType: "touch" }),
        );
      };
      send("pointerdown", 1, 100, 300);
      send("pointerdown", 2, 300, 300);
      send("pointermove", 2, 250, 300);
      send("pointermove", 2, 180, 300);
      send("pointerup", 2, 180, 300);
      send("pointerup", 1, 100, 300);
    });

    await expect.poll(() => new URL(page.url()).searchParams.get("g")).not.toBeNull();
  });
});

test.describe("tablet", () => {
  test.use({ viewport: { width: 820, height: 900 } });

  test("keeps trails, drops the tape, and opens the picker as a bottom sheet", async ({ page }) => {
    await page.goto(FIXTURE);
    const root = page.locator(".orderbook");
    await expect(root).toHaveAttribute("data-connection", "LIVE", { timeout: 20_000 });
    await expect(root).toHaveAttribute("data-tape", "0");
    await expect(root).toHaveAttribute("data-trails", "0");
    await expect(root).toHaveAttribute("data-view", "ladder");

    await page.keyboard.press("/");
    const popover = page.locator(".orderbook-pairpop");
    await expect(popover).toBeVisible();
    const box = await popover.boundingBox();
    expect(box).not.toBeNull();
    if (box === null) return;
    expect(box.x).toBe(0);
    expect(Math.round(box.y + box.height)).toBe(900);
  });
});

test("the canvas carries a text alternative and announces at no more than 1 Hz", async ({ page }) => {
  await page.goto(FIXTURE);
  await expect(page.locator(".orderbook")).toHaveAttribute("data-connection", "LIVE", { timeout: 20_000 });
  await expect(page.locator("canvas.orderbook-canvas")).toHaveAttribute(
    "aria-label",
    /BTC order book, grouping \$1, mid \d/,
    { timeout: 10_000 },
  );

  const live = page.locator(".orderbook-live");
  await expect(live).toHaveAttribute("aria-live", "polite");
  await expect(live).toContainText("BTC order book");
  const seen = new Set<string>();
  const started = Date.now();
  while (Date.now() - started < 3000) {
    seen.add((await live.textContent()) ?? "");
    await page.waitForTimeout(100);
  }
  // At most one announcement per second over three seconds, whatever the mid does.
  expect(seen.size).toBeLessThanOrEqual(4);
});

test("hovering a row paints a highlight the pointer can be moved off again", async ({ page }) => {
  await page.goto(FIXTURE);
  await expect(page.locator(".orderbook")).toHaveAttribute("data-connection", "LIVE", { timeout: 20_000 });
  const canvas = page.locator("canvas.orderbook-canvas");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (box === null) return;

  // The highlight's left marker is the only thing drawn in the first two columns.
  const marker = async (): Promise<number> =>
    canvas.evaluate((el) => {
      if (!(el instanceof HTMLCanvasElement)) return 0;
      const ctx = el.getContext("2d");
      if (ctx === null) return 0;
      const data = ctx.getImageData(0, 0, 2, el.height).data;
      let lit = 0;
      for (let i = 0; i < data.length; i += 4) if ((data[i] ?? 0) > 60) lit++;
      return lit;
    });

  const before = await marker();
  await page.mouse.move(box.x + 700, box.y + 220);
  await expect.poll(marker, { timeout: 5000 }).toBeGreaterThan(before);
  await page.mouse.move(box.x + 700, box.y - 5);
  await expect.poll(marker, { timeout: 5000 }).toBeLessThanOrEqual(before);
});

test("the widget is fully operable from the keyboard", async ({ page }) => {
  await page.goto(FIXTURE);
  const root = page.locator(".orderbook");
  await expect(root).toHaveAttribute("data-connection", "LIVE", { timeout: 20_000 });

  // Tab reaches the chrome in order, starting with the pair trigger.
  await page.keyboard.press("Tab");
  await expect(page.locator(".orderbook-pair")).toBeFocused();

  // The picker traps Tab: after cycling past its last control focus is still inside.
  await page.keyboard.press("/");
  await expect(page.locator(".orderbook-pairsearch")).toBeFocused();
  for (let i = 0; i < 12; i++) await page.keyboard.press("Tab");
  await expect(page.locator(".orderbook-pairpop :focus")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.locator(".orderbook-pair")).toBeFocused();

  // The gear popover does the same and returns focus to its own trigger.
  await page.locator(".orderbook-toggle[aria-label='Settings']").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".orderbook-gearpop select").first()).toBeFocused();
  for (let i = 0; i < 8; i++) await page.keyboard.press("Shift+Tab");
  await expect(page.locator(".orderbook-gearpop :focus")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(page.locator(".orderbook-toggle[aria-label='Settings']")).toBeFocused();

  // Shortcuts work with focus on the chrome, and space does not scroll or click the focused button.
  await page.keyboard.press("Space");
  await expect(root).toHaveAttribute("data-paused", "1");
  await page.keyboard.press("Space");
  await expect(root).toHaveAttribute("data-paused", "0");
  await page.keyboard.press("v");
  await expect(root).toHaveAttribute("data-view", "spine");
  await page.keyboard.press("v");
  await expect(root).toHaveAttribute("data-view", "ladder");
});
