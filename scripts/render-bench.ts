import { chromium } from "@playwright/test";

/**
 * Render benchmark (ADR 0006): the real widget replaying a real recording in
 * headless Chromium. Numbers are labelled with the viewport and DPR they were
 * emulated at — a phone-sized DPR 3 canvas is four times the pixels of the
 * desktop one, and saying "60 fps" without that is meaningless.
 *
 * Telemetry comes from the widget's own HUD, so the bench measures what the
 * user sees rather than a parallel code path.
 */

/**
 * How the published frame figures are derived: the HUD reports p50/p95 over
 * its own rolling 120-frame buffer, and the bench takes the median of those
 * samples across the run. That is a typical frame cost, not a percentile over
 * every frame in the run, and the README says so.
 */

/** One viewport's result. */
export type RenderResult = {
  readonly label: string;
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
  readonly cadence: string;
  readonly fps: number;
  /** Median of the HUD's rolling p50 samples. */
  readonly frameP50Ms: number;
  /** Median of the HUD's rolling p95 samples. */
  readonly frameP95Ms: number;
  /** Emulated headless Chromium, not a device (ADR 0006). */
  readonly emulated: true;
};

/** What to measure. */
export type RenderCase = {
  readonly label: string;
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
  /** `60`, `30` or `update`. */
  readonly cadence: string;
};

const HUD = /RENDER\s+([\d.]+) fps\s+frame p50 ([\d.]+) ms\s+p95 ([\d.]+) ms/;

/**
 * Replay a recording in a browser and read the widget's render telemetry.
 *
 * @param baseUrl - Where the built demo is served.
 * @param cases - Viewports and cadences to measure.
 * @param seconds - Sampling window per case, after a warm-up.
 * @returns One result per case.
 */
export async function runRenderBench(
  baseUrl: string,
  cases: ReadonlyArray<RenderCase>,
  seconds: number,
): Promise<ReadonlyArray<RenderResult>> {
  const browser = await chromium.launch();
  const results: RenderResult[] = [];
  try {
    for (const c of cases) {
      const context = await browser.newContext({
        viewport: { width: c.width, height: c.height },
        deviceScaleFactor: c.dpr,
      });
      const page = await context.newPage();
      // Cadence is a preference, not URL state (ADR 0008): seed it the way the widget reads it.
      await page.addInitScript(
        (cadence: string) => localStorage.setItem("ob.prefs", JSON.stringify({ cadence })),
        c.cadence,
      );
      await page.goto(`${baseUrl}/?fixture=btc-perp-active&speed=1`);
      await page.waitForSelector(".orderbook[data-connection='LIVE']", { timeout: 30_000 });
      await page.keyboard.press("m");
      // The HUD is one row per metric group; render telemetry is its own row.
      await page.waitForSelector(".orderbook-hud-row");
      // Warm-up: springs settle and the trail column fills before sampling.
      await page.waitForTimeout(5000);
      const samples: Array<[number, number, number]> = [];
      const until = Date.now() + seconds * 1000;
      while (Date.now() < until) {
        const text = (await page.locator(".orderbook-hud").textContent()) ?? "";
        const m = HUD.exec(text);
        if (m !== null) samples.push([Number(m[1]), Number(m[2]), Number(m[3])]);
        await page.waitForTimeout(500);
      }
      await context.close();
      results.push({
        label: c.label,
        width: c.width,
        height: c.height,
        dpr: c.dpr,
        cadence: c.cadence,
        fps: median(samples.map((s) => s[0])),
        frameP50Ms: median(samples.map((s) => s[1])),
        frameP95Ms: median(samples.map((s) => s[2])),
        emulated: true,
      });
    }
  } finally {
    await browser.close();
  }
  return results;
}

function median(values: ReadonlyArray<number>): number {
  if (values.length === 0) return 0;
  const sorted = [...values].toSorted((a, b) => a - b);
  const mid = sorted[Math.floor(sorted.length / 2)] ?? 0;
  return Math.round(mid * 100) / 100;
}
