import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import * as Grouping from "../domain/grouping";
import { parseFixture, precisionOf } from "./fixture";
import { parseWireMessage } from "./wire";
import type { Precision } from "../domain/grouping";
import { createSubscriptionGate } from "./subscription-gate";

const full: Precision = { _tag: "full" };
const sig5: Precision = { _tag: "aggregated", nSigFigs: 5, mantissa: undefined };
const sig5m5: Precision = { _tag: "aggregated", nSigFigs: 5, mantissa: 5 };
const sig4: Precision = { _tag: "aggregated", nSigFigs: 4, mantissa: undefined };

describe("subscription gate", () => {
  it("rejects pushes until both streams are acknowledged", () => {
    const gate = createSubscriptionGate(sig5, 10);
    expect(gate.accepts("slow", [810_690])).toBe(false);
    gate.acked("slow", sig5);
    expect(gate.accepts("slow", [810_690])).toBe(true);
    expect(gate.accepts("fast", [810_690])).toBe(false);
    gate.acked("fast", sig5);
    expect(gate.accepts("fast", [810_690])).toBe(true);
  });

  it("rejects a push whose prices are off the active grid, whatever the acks said", () => {
    const gate = createSubscriptionGate(sig5, 10);
    gate.acked("slow", sig5);
    gate.acked("fast", sig5);
    expect(gate.accepts("slow", [810_690, 810_680])).toBe(true);
    expect(gate.accepts("slow", [810_695]), "finer than the grid").toBe(false);
  });

  it("switching precision closes the gate until the new acks land", () => {
    const gate = createSubscriptionGate(sig5, 10);
    gate.acked("slow", sig5);
    gate.acked("fast", sig5);
    const change = gate.select(sig5m5, 50);
    expect(change).toEqual({ _tag: "resubscribe", from: sig5, to: sig5m5 });
    expect(gate.accepts("slow", [810_650]), "old subscription still in flight").toBe(false);
    gate.acked("slow", sig5m5);
    expect(gate.accepts("slow", [810_650])).toBe(true);
    expect(gate.accepts("slow", [810_690]), "on the old grid, not the new one").toBe(false);
  });

  it("ignores a late ack for the precision that was just left behind", () => {
    const gate = createSubscriptionGate(sig5, 10);
    gate.acked("slow", sig5);
    gate.acked("fast", sig5);
    gate.select(sig5m5, 50);
    gate.acked("slow", sig5);
    expect(gate.accepts("slow", [810_650])).toBe(false);
    gate.acked("slow", sig5m5);
    expect(gate.accepts("slow", [810_650])).toBe(true);
  });

  it("queues a change requested before the first subscription is acknowledged", () => {
    const gate = createSubscriptionGate(sig5, 10);
    expect(gate.select(sig5m5, 50)).toEqual({ _tag: "queued" });
    gate.acked("slow", sig5);
    expect(gate.acked("fast", sig5)).toEqual({ _tag: "resubscribe", from: sig5, to: sig5m5 });
  });

  it("queues a change made while another is still pending and fires it once the acks land", () => {
    const gate = createSubscriptionGate(sig5, 10);
    gate.acked("slow", sig5);
    gate.acked("fast", sig5);
    expect(gate.select(sig5m5, 50)._tag).toBe("resubscribe");
    expect(gate.select(sig4, 100), "still waiting for the first change").toEqual({ _tag: "queued" });
    expect(gate.acked("slow", sig5m5)).toEqual({ _tag: "pending" });
    expect(gate.acked("fast", sig5m5)).toEqual({ _tag: "resubscribe", from: sig5m5, to: sig4 });
    gate.acked("slow", sig4);
    gate.acked("fast", sig4);
    expect(gate.accepts("slow", [810_600])).toBe(true);
  });

  it("selecting the precision already in use changes nothing", () => {
    const gate = createSubscriptionGate(sig5, 10);
    gate.acked("slow", sig5);
    gate.acked("fast", sig5);
    expect(gate.select(sig5, 10)).toEqual({ _tag: "unchanged" });
    expect(gate.accepts("slow", [810_690])).toBe(true);
  });

  it("treats full precision as accepting every price", () => {
    const gate = createSubscriptionGate(full, 1);
    gate.acked("slow", full);
    expect(gate.accepts("slow", [810_691])).toBe(true);
  });
});

describe("precision-swap recording", () => {
  it("accepts only pushes that match the acknowledged subscription, dropping in-flight old ones", () => {
    const parsed = parseFixture(gunzipSync(readFileSync("fixtures/btc-precision-swap.jsonl.gz")).toString("utf8"));
    if (parsed._tag === "err") throw parsed.error;
    const fx = parsed.value;
    const gridOf = (p: Precision): number => Grouping.gridTickFor(81_000, p, fx.meta.scale);
    const gate = createSubscriptionGate(fx.meta.precision, gridOf(fx.meta.precision));
    let accepted = 0;
    let dropped = 0;
    let resubscribes = 0;
    const seenGrids = new Set<number>();
    for (const line of fx.lines) {
      if (line._tag === "control") {
        if (line.control.type !== "resubscribe") continue;
        const to = precisionOf(line.control.to);
        const action = gate.select(to, gridOf(to));
        expect(action._tag === "resubscribe" || action._tag === "queued").toBe(true);
        if (action._tag === "resubscribe") resubscribes++;
        continue;
      }
      const r = parseWireMessage(line.frame, {
        coin: fx.meta.coin,
        scale: fx.meta.scale,
        rx: line.rx,
        tradesHistorical: false,
      });
      if (r._tag === "err") throw r.error;
      const ev = r.value;
      if (ev._tag === "ack") {
        if (ev.subscription._tag !== "l2Book" || ev.method !== "subscribe") continue;
        const queued = gate.acked(ev.subscription.stream, ev.subscription.precision);
        if (queued._tag === "resubscribe") resubscribes++;
        continue;
      }
      if (ev._tag !== "l2Book") continue;
      const prices = [...ev.bids, ...ev.asks].map((l) => l.px);
      if (gate.accepts(ev.stream, prices)) {
        accepted++;
        const grid = gridOf(gate.active());
        for (const px of prices) expect(px % grid, "accepted pushes are on the active grid").toBe(0);
        seenGrids.add(grid);
      } else {
        dropped++;
      }
    }
    expect(resubscribes, "the recording carries two precision changes").toBe(2);
    expect(accepted).toBeGreaterThan(100);
    expect(dropped, "old pushes arrive after the unsubscribe and must be dropped").toBeGreaterThan(0);
    expect(seenGrids.size, "three precisions were live across the recording").toBe(3);
  });
});
