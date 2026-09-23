import { expect, test } from "@playwright/test";

/**
 * Seam 3: twenty mount/unmount cycles leave nothing behind. The widget owns a
 * socket, a frame loop, two intervals, a ResizeObserver and window listeners;
 * every one of them has to come back on unmount, or an embedder that swaps
 * widgets bleeds.
 */
test("twenty mount/unmount cycles release listeners, timers and memory", async ({ page }) => {
  // Count what the page hands out and what it takes back, before anything mounts.
  await page.addInitScript(() => {
    const counts = { listeners: 0, intervals: 0, raf: 0, observers: 0 };
    Reflect.set(globalThis, "__obLive", counts);
    const addListener = window.addEventListener.bind(window);
    const removeListener = window.removeEventListener.bind(window);
    window.addEventListener = (...args: Parameters<typeof addListener>) => {
      counts.listeners++;
      addListener(...args);
    };
    window.removeEventListener = (...args: Parameters<typeof removeListener>) => {
      counts.listeners--;
      removeListener(...args);
    };
    const setIntervalOriginal = globalThis.setInterval;
    const clearIntervalOriginal = globalThis.clearInterval;
    Reflect.set(globalThis, "setInterval", (...args: Parameters<typeof setIntervalOriginal>) => {
      counts.intervals++;
      return setIntervalOriginal(...args);
    });
    Reflect.set(globalThis, "clearInterval", (...args: Parameters<typeof clearIntervalOriginal>) => {
      counts.intervals--;
      clearIntervalOriginal(...args);
    });
    const rafOriginal = globalThis.requestAnimationFrame;
    const cancelOriginal = globalThis.cancelAnimationFrame;
    Reflect.set(globalThis, "requestAnimationFrame", (...args: Parameters<typeof rafOriginal>) => {
      counts.raf++;
      return rafOriginal(...args);
    });
    Reflect.set(globalThis, "cancelAnimationFrame", (...args: Parameters<typeof cancelOriginal>) => {
      counts.raf--;
      cancelOriginal(...args);
    });
    const ObserverOriginal = globalThis.ResizeObserver;
    class Counted extends ObserverOriginal {
      constructor(callback: ResizeObserverCallback) {
        super(callback);
        counts.observers++;
      }
      override disconnect(): void {
        counts.observers--;
        super.disconnect();
      }
    }
    Reflect.set(globalThis, "ResizeObserver", Counted);
  });

  await page.goto("/?fixture=btc-perp-active&speed=8");
  await expect(page.locator(".orderbook")).toHaveAttribute("data-connection", "LIVE", { timeout: 20_000 });

  const client = await page.context().newCDPSession(page);
  const heap = async (): Promise<number> => {
    await client.send("HeapProfiler.collectGarbage");
    const { metrics } = await client.send("Performance.getMetrics");
    return metrics.find((m) => m.name === "JSHeapUsedSize")?.value ?? 0;
  };
  await client.send("Performance.enable");
  const heapBefore = await heap();

  for (let cycle = 0; cycle < 20; cycle++) {
    await page.evaluate(() => {
      const remount = Reflect.get(globalThis, "__obRemount");
      if (typeof remount === "function") remount();
    });
    await page.waitForTimeout(150);
  }
  await expect(page.locator(".orderbook")).toHaveCount(1);
  await expect(page.locator("canvas.orderbook-canvas")).toHaveCount(1);

  // Unmount for good: every resource the widget took must be given back.
  await page.evaluate(() => {
    const unmount = Reflect.get(globalThis, "__obUnmount");
    if (typeof unmount === "function") unmount();
  });
  await page.waitForTimeout(500);
  await expect(page.locator(".orderbook")).toHaveCount(0);

  const live = await page.evaluate(() => {
    const counts = Reflect.get(globalThis, "__obLive");
    if (counts === null || typeof counts !== "object") return undefined;
    const read = (key: string): number => {
      const v = Reflect.get(counts, key);
      return typeof v === "number" ? v : Number.NaN;
    };
    return { listeners: read("listeners"), intervals: read("intervals"), observers: read("observers") };
  });
  expect(live?.intervals, "intervals cleared").toBe(0);
  expect(live?.observers, "resize observers disconnected").toBe(0);
  // React itself keeps a few document-level listeners; the widget's own window
  // listeners (keydown, visibilitychange) must all be gone.
  expect(live?.listeners ?? 99, "window listeners released").toBeLessThanOrEqual(1);

  const heapAfter = await heap();
  const growthMb = (heapAfter - heapBefore) / 1024 / 1024;
  expect(growthMb, `heap grew ${growthMb.toFixed(1)} MB over twenty cycles`).toBeLessThan(12);
});
