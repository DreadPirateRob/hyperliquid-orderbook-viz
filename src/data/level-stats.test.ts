import { describe, expect, it } from "vitest";
import * as Tick from "../domain/tick";
import { createLevelStats } from "./level-stats";

/**
 * The rolling metric state behind churn, cancel ratios and refill medians.
 * These assert the published formulas, because the HUD presents them as
 * measurements rather than impressions.
 */

function tick(n: number): Tick.Tick {
  const r = Tick.fromInteger(n);
  if (r._tag === "err") throw r.error;
  return r.value;
}

const NO_SPLIT = { consumed: 0, cancelled: 0 };

describe("churn", () => {
  it("counts additions and growth, not only decreases", () => {
    const s = createLevelStats();
    // One level grows from 10 to 20 at t = 1000.
    s.change("bid", tick(1000), 10, 20, 1000, true, NO_SPLIT);
    const w = s.window("bid", 1000);

    // Definition: eventChurn = (added + vanished + grew + shrank) / 5 s,
    // volumeChurn = Σ|Δsize| / 5 s.
    expect(w.eventChurn).toBeCloseTo(0.2, 9);
    expect(w.volumeChurn).toBeCloseTo(2, 9);
  });

  it("keeps cancel ratios about decreases only", () => {
    const s = createLevelStats();
    s.change("bid", tick(1000), 10, 20, 1000, true, NO_SPLIT);
    s.change("bid", tick(1000), 20, 15, 1100, true, { consumed: 0, cancelled: 5 });
    const w = s.window("bid", 1100);

    // Two churn events, but only the decrease may count towards cancellation.
    expect(w.eventChurn).toBeCloseTo(0.4, 9);
    expect(w.cancelRatioCount).toBeCloseTo(1, 9);
    expect(w.cancelRatioVolume).toBeCloseTo(1, 9);
  });
});

describe("refill median", () => {
  it("records each completed watch once, whatever the tick rate", () => {
    const s = createLevelStats();
    const fast = tick(1000);
    const slow = tick(1001);
    // Both levels lose more than half their size, so a watch opens on each.
    s.change("bid", fast, 10, 1, 0, true, NO_SPLIT);
    s.change("bid", slow, 10, 1, 0, true, NO_SPLIT);

    s.change("bid", fast, 1, 9, 1000, true, NO_SPLIT);
    for (let t = 500; t <= 20_000; t += 500) {
      if (t === 10_000) s.change("bid", slow, 1, 9, t, true, NO_SPLIT);
      s.tick(t);
    }

    // Two completions: 1 s and 10 s. `times[len >> 1]` on two samples is the
    // upper one. Re-appending the early completion on every host tick buries
    // the later one and reports 1 s instead.
    expect(s.window("bid", 20_000).medianRefillMs).toBe(10_000);
  });
});
