import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import * as Grouping from "../domain/grouping";
import { createEngine } from "./engine";
import type { BookSnapshot } from "./engine-api.types";
import type { FeedEvent } from "./feed-events.types";
import { createFixtureFeed } from "./fixture-feed";
import { parseFixture } from "./fixture";
import { parseWireMessage } from "./wire";

/**
 * Scenario proof (spec, story 45): deliberately broken copies of a real
 * recording. Every case states what the widget does with bad input — which
 * frame is dropped, what the book looks like afterwards — rather than
 * asserting that nothing happened.
 */

const CLEAN = gunzipSync(readFileSync("fixtures/btc-perp-active.jsonl.gz")).toString("utf8");

type Replay = {
  readonly book: {
    readonly bids: ReadonlyArray<readonly [number, number]>;
    readonly asks: ReadonlyArray<readonly [number, number]>;
  };
  readonly snapshot: BookSnapshot;
  /** Frames the wire layer refused, by error tag. */
  readonly dropped: ReadonlyArray<string>;
  readonly applied: number;
  readonly versionBumps: number;
  /** Level events produced by the last applied frame. */
  readonly lastEvents: number;
};

/** Replay a recording's text through wire + engine, counting what was refused. */
function replay(text: string, upTo = Number.POSITIVE_INFINITY): Replay {
  const parsed = parseFixture(text);
  if (parsed._tag === "err") throw parsed.error;
  const fx = parsed.value;
  const gridTick = Grouping.gridTickFor(firstMid(text), fx.meta.precision, fx.meta.scale);
  const engine = createEngine({ gridTick, scale: fx.meta.scale });
  const dropped: string[] = [];
  let applied = 0;
  let versionBumps = 0;
  let version = engine.snapshot().version;
  let lastEvents = 0;
  let historical = true;
  for (const line of fx.lines) {
    if (line._tag !== "frame" || applied >= upTo) continue;
    const r = parseWireMessage(line.frame, {
      coin: fx.meta.coin,
      scale: fx.meta.scale,
      rx: line.rx,
      tradesHistorical: historical,
    });
    if (r._tag === "err") {
      dropped.push(r.error._tag);
      continue;
    }
    if (r.value._tag === "ignored") continue;
    if (r.value._tag === "trades") historical = false;
    engine.apply(r.value);
    applied++;
    lastEvents = engine.drain().length;
    const s = engine.snapshot();
    if (s.version !== version) versionBumps++;
    version = s.version;
  }
  const snapshot = engine.snapshot();
  return {
    book: {
      bids: snapshot.bids.map((l) => [l.px, l.sz] as const),
      asks: snapshot.asks.map((l) => [l.px, l.sz] as const),
    },
    snapshot,
    dropped,
    applied,
    versionBumps,
    lastEvents,
  };
}

function firstMid(text: string): number {
  const parsed = parseFixture(text);
  if (parsed._tag === "err") throw parsed.error;
  const fx = parsed.value;
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
  throw new Error("no book in recording");
}

/** Index of the nth line (1-based body, header excluded) carrying an `l2Book` frame. */
function bookLineIndex(rows: ReadonlyArray<string>, nth: number): number {
  let seen = 0;
  for (let i = 1; i < rows.length; i++) {
    if ((rows[i] ?? "").includes('"ch":"l2Book"')) {
      seen++;
      if (seen === nth) return i;
    }
  }
  throw new Error("recording has too few book pushes");
}

const rows = CLEAN.split("\n").filter((l) => l.length > 0);
const clean = replay(CLEAN);

describe("broken recordings", () => {
  it("a duplicated push changes nothing: same book, no level events", () => {
    const at = bookLineIndex(rows, 3);
    const line = rows[at] ?? "";
    const doubled = [...rows.slice(0, at + 1), line, ...rows.slice(at + 1)].join("\n");

    const prefix = replay(rows.slice(0, at + 1).join("\n"));
    const withDuplicate = replay([...rows.slice(0, at + 1), line].join("\n"));
    // The push is snapshot-authoritative, so applying it twice is a no-op in content.
    expect(withDuplicate.book).toEqual(prefix.book);
    expect(withDuplicate.lastEvents).toBe(0);
    expect(replay(doubled).book).toEqual(clean.book);
  });

  it("a non-monotonic push is applied as sent: the feed carries no sequence to order by", () => {
    const a = bookLineIndex(rows, 4);
    const b = bookLineIndex(rows, 5);
    const swapped = [...rows];
    const rowA = rows[a] ?? "";
    const rowB = rows[b] ?? "";
    swapped[a] = rowB;
    swapped[b] = rowA;
    const out = replay(swapped.join("\n"));

    // Nothing is rejected and nothing crashes; the book is simply last-writer-wins.
    expect(out.dropped).toEqual([]);
    expect(out.applied).toBe(clean.applied);
    for (const side of [out.snapshot.bids, out.snapshot.asks]) {
      for (const l of side) expect(l.sz).toBeGreaterThan(0);
    }
    const bb = out.snapshot.bids[0];
    const ba = out.snapshot.asks[0];
    if (bb !== undefined && ba !== undefined) expect(bb.px).toBeLessThan(ba.px);
  });

  it("a garbage line fails the whole recording, naming the line", () => {
    const at = bookLineIndex(rows, 2);
    const broken = [...rows];
    broken[at] = "{not json";
    const parsed = parseFixture(broken.join("\n"));
    expect(parsed._tag).toBe("err");
    if (parsed._tag === "err") expect(parsed.error.message).toContain(`line ${at + 1}`);
  });

  it("a structurally wrong frame is dropped and the book keeps its last good state", () => {
    const at = bookLineIndex(rows, 6);
    const broken = [...rows];
    broken[at] = JSON.stringify({ rx: 1, ch: "l2Book", data: { coin: "BTC", levels: "nope", time: 1 } });
    const out = replay(broken.join("\n"));

    expect(out.dropped).toEqual(["MalformedFrame"]);
    expect(out.applied).toBe(clean.applied - 1);
    expect(out.book).toEqual(clean.book);
  });

  it("an off-grid price is refused by the wire layer, not folded into the book", () => {
    const at = bookLineIndex(rows, 7);
    const broken = [...rows];
    // A price with more decimals than the market's scale allows.
    broken[at] = (rows[at] ?? "").replace(/"px":"(\d+)\.(\d)"/, '"px":"$1.$20000001"');
    expect(broken[at]).not.toBe(rows[at]);
    const out = replay(broken.join("\n"));

    expect(out.dropped).toEqual(["OffGridPrice"]);
    expect(out.applied).toBe(clean.applied - 1);
    expect(out.book).toEqual(clean.book);
  });
});

describe("drop and reconnect", () => {
  it("reports the drop, then comes back LIVE with a rebuilt book", () => {
    const text = gunzipSync(readFileSync("fixtures/btc-reconnect.jsonl.gz")).toString("utf8");
    const parsed = parseFixture(text);
    if (parsed._tag === "err") throw parsed.error;
    const feed = createFixtureFeed(parsed.value, { speed: Number.POSITIVE_INFINITY });
    const engine = createEngine({ gridTick: 1, scale: parsed.value.meta.scale });
    const states: string[] = [];
    const stop = feed.start((e: FeedEvent) => {
      engine.apply(e);
      const c = engine.snapshot().connection;
      if (states.at(-1) !== c) states.push(c);
    });
    // At infinite speed the whole recording is delivered inside `start`.
    stop();

    expect(states).toContain("DISCONNECTED");
    // Back to LIVE after the drop, not stuck in the disconnected state.
    expect(states.lastIndexOf("LIVE")).toBeGreaterThan(states.indexOf("DISCONNECTED"));
    const s = engine.snapshot();
    expect(s.bids.length).toBeGreaterThan(0);
    expect(s.asks.length).toBeGreaterThan(0);
  });
});
