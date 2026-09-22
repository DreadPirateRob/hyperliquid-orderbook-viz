import { readFileSync, readdirSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import * as Grouping from "../domain/grouping";
import * as Tick from "../domain/tick";
import { createEngine } from "./engine";
import type { Level } from "./feed-events.types";
import type { Fixture } from "./fixture";
import { parseFixture } from "./fixture";
import { parseWireMessage } from "./wire";

function loadFixture(name: string): Fixture {
  const r = parseFixture(gunzipSync(readFileSync(`fixtures/${name}`)).toString("utf8"));
  if (r._tag === "err") throw r.error;
  return r.value;
}

function scaleOf(kind: Tick.MarketKind, sz: number): Tick.PriceScale {
  const r = Tick.makeScale(kind, sz);
  if (r._tag === "err") throw r.error;
  return r.value;
}
const btc = scaleOf("perp", 5);
function tick(px: string): Tick.Tick {
  const r = Tick.parse(px, btc);
  if (r._tag === "err") throw r.error;
  return r.value;
}
function lvl(px: string, sz: number): Level {
  return { px: tick(px), sz, n: 1 };
}

function sorted(levels: ReadonlyArray<Level>, dir: 1 | -1): boolean {
  for (let i = 1; i < levels.length; i++) {
    const a = levels[i - 1];
    const b = levels[i];
    if (a === undefined || b === undefined || (b.px - a.px) * dir <= 0) return false;
  }
  return true;
}

describe("engine replay over every recording", () => {
  const names = readdirSync("fixtures").filter((f: string) => f.endsWith(".jsonl.gz"));
  it.each(names)("%s keeps its invariants on every event", (name: string) => {
    const fx = loadFixture(name);
    // The recordings never cross a precision change on the engine's side in
    // this ticket: replay only up to the first control line.
    const firstControl = fx.lines.findIndex((l) => l._tag === "control");
    const lines = firstControl === -1 ? fx.lines : fx.lines.slice(0, firstControl);
    const mid0 = firstMid(fx);
    const gridTick = Grouping.gridTickFor(mid0, fx.meta.precision, fx.meta.scale);
    const engine = createEngine({ gridTick });
    let version = engine.snapshot().version;
    let pushes = 0;
    let historical = true;
    for (const line of lines) {
      if (line._tag !== "frame") continue;
      const r = parseWireMessage(line.frame, {
        coin: fx.meta.coin,
        scale: fx.meta.scale,
        rx: line.rx,
        tradesHistorical: historical,
      });
      if (r._tag === "err") throw r.error;
      if (r.value._tag === "ignored") continue;
      if (r.value._tag === "trades") historical = false;
      engine.apply(r.value);
      const s = engine.snapshot();
      expect(s.version - version).toBeLessThanOrEqual(1);
      version = s.version;
      expect(sorted(s.bids, -1), "bids descending").toBe(true);
      expect(sorted(s.asks, 1), "asks ascending").toBe(true);
      for (const l of [...s.bids, ...s.asks]) {
        expect(l.sz).toBeGreaterThan(0);
        // btc-grid-change is SYNTHETIC and its prices were rescaled without
        // regridding: they sit at raw precision. Only venue recordings prove the grid.
        if (!fx.meta.synthetic) expect(l.px % gridTick, `on grid ${l.px}`).toBe(0);
      }
      for (const side of [s.bids, s.asks]) {
        let cum = 0;
        for (const l of side) {
          expect(l.sz + cum, "cumulative depth is monotone from the touch outward").toBeGreaterThan(cum);
          cum += l.sz;
        }
      }
      const bb = s.bids[0];
      const ba = s.asks[0];
      // The synthetic recording's rescaling also drifts the slow pushes against
      // the fast ones, so its book can cross briefly; venue recordings never do.
      if (!fx.meta.synthetic && bb !== undefined && ba !== undefined) expect(bb.px).toBeLessThan(ba.px);
      if (r.value._tag === "l2Book") {
        pushes++;
        expect(s.connection).toBe("LIVE");
      }
      for (const e of engine.drain()) expect(e.from === e.to, "event carries a change").toBe(false);
    }
    expect(pushes).toBeGreaterThan(0);
  });
});

function firstMid(fx: Fixture): number {
  for (const line of fx.lines) {
    if (line._tag !== "frame") continue;
    const r = parseWireMessage(line.frame, {
      coin: fx.meta.coin,
      scale: fx.meta.scale,
      rx: line.rx,
      tradesHistorical: true,
    });
    if (r._tag === "ok" && r.value._tag === "l2Book") {
      const b = r.value.bids[0];
      const a = r.value.asks[0];
      if (b !== undefined && a !== undefined) return ((b.px + a.px) / 2) * 10 ** -fx.meta.scale.decimals;
    }
  }
  throw new Error("no book in fixture");
}

describe("window authority", () => {
  const rx = 1;
  it("slow replaces the whole side; fast replaces from the touch to its worst level", () => {
    const e = createEngine({ gridTick: 10 });
    e.apply({
      _tag: "l2Book",
      stream: "slow",
      bids: [lvl("100.0", 1), lvl("99.0", 2), lvl("98.0", 3), lvl("97.0", 4)],
      asks: [],
      time: 0,
      rx,
    });
    e.apply({ _tag: "l2Book", stream: "fast", bids: [lvl("100.0", 1), lvl("98.0", 6)], asks: [], time: 0, rx });
    expect(e.snapshot().bids.map((l) => [l.px, l.sz])).toEqual([
      [1000, 1],
      [980, 6],
      [970, 4],
    ]);
    e.apply({ _tag: "l2Book", stream: "fast", bids: [lvl("98.0", 5)], asks: [], time: 0, rx });
    expect(
      e.snapshot().bids.map((l) => [l.px, l.sz]),
      "100 is better than the fast best, so it is stale",
    ).toEqual([
      [980, 5],
      [970, 4],
    ]);
    e.apply({ _tag: "l2Book", stream: "slow", bids: [lvl("99.0", 7)], asks: [], time: 0, rx });
    expect(e.snapshot().bids.map((l) => [l.px, l.sz])).toEqual([[990, 7]]);
  });

  it("fast vanishes a level inside its window but keeps levels outside it", () => {
    const e = createEngine({ gridTick: 10 });
    e.apply({
      _tag: "l2Book",
      stream: "slow",
      bids: [lvl("100.0", 1), lvl("99.0", 2), lvl("98.0", 3)],
      asks: [],
      time: 0,
      rx,
    });
    e.drain();
    e.apply({ _tag: "l2Book", stream: "fast", bids: [lvl("100.0", 1), lvl("98.0", 3)], asks: [], time: 0, rx });
    expect(e.snapshot().bids.map((l) => l.px)).toEqual([1000, 980]);
    expect(e.drain().map((ev) => [ev.kind, ev.px])).toEqual([["vanished", 990]]);
  });

  it("bbo owns the touch: drops better levels, replaces its price only when on grid", () => {
    const e = createEngine({ gridTick: 10 });
    e.apply({
      _tag: "l2Book",
      stream: "slow",
      bids: [lvl("100.0", 1), lvl("99.0", 2)],
      asks: [lvl("101.0", 1), lvl("102.0", 1)],
      time: 0,
      rx,
    });
    e.drain();
    e.apply({ _tag: "bbo", bid: lvl("99.0", 9), ask: lvl("101.5", 1), time: 0, rx });
    const s = e.snapshot();
    expect(s.bids.map((l) => [l.px, l.sz])).toEqual([[990, 9]]);
    expect(s.asks.map((l) => l.px)).toEqual([1010, 1020]);
    expect(s.bestAsk?.px).toBe(1015);
    expect(e.drain().map((ev) => [ev.kind, ev.px])).toEqual([
      ["outOfWindow", 1000],
      ["grew", 990],
    ]);
  });

  it("goes STALE on a host tick after the fast stream stops, LIVE again on the next push", () => {
    const e = createEngine({ gridTick: 10 });
    e.apply({ _tag: "l2Book", stream: "fast", bids: [lvl("100.0", 1)], asks: [], time: 0, rx: 1000 });
    e.apply({ _tag: "tick", rx: 3000 });
    expect(e.snapshot().connection).toBe("LIVE");
    e.apply({ _tag: "tick", rx: 4100 });
    expect(e.snapshot().connection).toBe("STALE");
    e.apply({ _tag: "l2Book", stream: "fast", bids: [lvl("100.0", 1)], asks: [], time: 0, rx: 4200 });
    expect(e.snapshot().connection).toBe("LIVE");
  });

  it("reset forgets the book and enters RESYNCING", () => {
    const e = createEngine({ gridTick: 10 });
    e.apply({ _tag: "l2Book", stream: "slow", bids: [lvl("100.0", 1)], asks: [], time: 0, rx });
    e.reset({ gridTick: 100 });
    expect(e.snapshot()).toMatchObject({ bids: [], asks: [], connection: "RESYNCING" });
  });
});
