import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FeedEvent } from "./feed-events.types";
import type { Fixture } from "./fixture";
import { parseFixture } from "./fixture";
import { createFixtureFeed } from "./fixture-feed";

const TEXT = [
  '{"meta":{"coin":"BTC","nSigFigs":5,"mantissa":null,"szDecimals":5,"kind":"perp","startedAt":1000,"note":""}}',
  '{"rx":1000,"ch":"subscriptionResponse","data":{"method":"subscribe","subscription":{"type":"l2Book","coin":"BTC","nSigFigs":5,"mantissa":null,"fast":false}}}',
  '{"rx":1200,"ch":"l2Book","data":{"coin":"BTC","time":1,"levels":[[{"px":"81069.0","sz":"1","n":1}],[{"px":"81070.0","sz":"1","n":1}]]}}',
  '{"rx":1300,"ch":"trades","data":[{"coin":"BTC","side":"B","px":"81070.0","sz":"1","time":1}]}',
  '{"rx":1400,"ch":"trades","data":[{"coin":"BTC","side":"B","px":"81070.0","sz":"1","time":2}]}',
  '{"rx":2000,"ch":"control","data":{"type":"disconnect"}}',
  '{"rx":2500,"ch":"control","data":{"type":"reconnect"}}',
  '{"rx":2600,"ch":"bbo","data":{"coin":"BTC","time":3,"bbo":[{"px":"81069.0","sz":"1","n":1},{"px":"81070.0","sz":"1","n":1}]}}',
].join("\n");

function fixture(): Fixture {
  const r = parseFixture(TEXT);
  if (r._tag === "err") throw r.error;
  return r.value;
}

describe("createFixtureFeed", () => {
  beforeEach(() => vi.useFakeTimers({ now: 50_000 }));
  afterEach(() => vi.useRealTimers());

  it("replays frames on the wall clock at the recorded spacing, rebasing rx", () => {
    const got: FeedEvent[] = [];
    const stop = createFixtureFeed(fixture(), { speed: 1 }).start((e) => got.push(e));
    expect(got.map((e) => e._tag)).toEqual(["market", "connection", "connection", "ack"]);
    vi.advanceTimersByTime(199);
    expect(got.length).toBe(4);
    vi.advanceTimersByTime(1);
    const book = got[4];
    expect(book?._tag).toBe("l2Book");
    expect(book?.rx).toBe(50_200);
    vi.advanceTimersByTime(300);
    const [t1, t2] = got.slice(5, 7);
    expect(t1?._tag === "trades" && t1.historical).toBe(true);
    expect(t2?._tag === "trades" && t2.historical).toBe(false);
    vi.advanceTimersByTime(1200);
    const tags = got.slice(7).map((e) => (e._tag === "connection" ? e.event._tag : e._tag));
    expect(tags).toEqual(["closed", "connecting", "open", "bbo", "closed"]);
    stop();
  });

  it("stops delivering after stop() and honours speed", () => {
    const got: FeedEvent[] = [];
    const stop = createFixtureFeed(fixture(), { speed: 10 }).start((e) => got.push(e));
    vi.advanceTimersByTime(20);
    expect(got.some((e) => e._tag === "l2Book")).toBe(true);
    stop();
    vi.advanceTimersByTime(10_000);
    expect(got.some((e) => e._tag === "bbo")).toBe(false);
  });

  it("applies a speed change from where playback has reached, without jumping or restarting", () => {
    const got: FeedEvent[] = [];
    const feed = createFixtureFeed(fixture(), { speed: 1 });
    const stop = feed.start((e) => got.push(e));
    // 100 ms in: halfway to the book push recorded 200 ms after the first line.
    vi.advanceTimersByTime(100);
    expect(got.some((e) => e._tag === "l2Book")).toBe(false);

    feed.setSpeed(10);
    // The remaining 100 ms of recorded time now takes 10 ms. A naive retiming
    // would place the push 20 ms after the start, i.e. already in the past, and
    // deliver it immediately; an anchored one still owes 10 ms.
    vi.advanceTimersByTime(9);
    expect(got.some((e) => e._tag === "l2Book")).toBe(false);
    vi.advanceTimersByTime(1);
    expect(got.some((e) => e._tag === "l2Book")).toBe(true);

    // Playback continues at the new speed rather than restarting: the rest of
    // the recording (1400 ms of it) arrives within 140 ms.
    vi.advanceTimersByTime(140);
    expect(got.some((e) => e._tag === "bbo")).toBe(true);
    stop();
  });

  it("ignores a speed that is not a positive number", () => {
    const got: FeedEvent[] = [];
    const feed = createFixtureFeed(fixture(), { speed: 1 });
    const stop = feed.start((e) => got.push(e));
    feed.setSpeed(0);
    feed.setSpeed(-4);
    feed.setSpeed(Number.NaN);
    vi.advanceTimersByTime(199);
    expect(got.some((e) => e._tag === "l2Book")).toBe(false);
    vi.advanceTimersByTime(1);
    expect(got.some((e) => e._tag === "l2Book")).toBe(true);
    stop();
  });
});
