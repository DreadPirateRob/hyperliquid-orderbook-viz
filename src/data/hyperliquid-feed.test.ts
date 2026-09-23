import { describe, expect, it, vi } from "vitest";
import type { FeedEvent } from "./feed-events.types";
import { createHyperliquidFeed } from "./hyperliquid-feed";

/**
 * Lifecycle of the live adapter: what happens when the venue's metadata call
 * fails, and what happens to a grouping choice made while the socket is down.
 * Both paths leave the user stuck when they are wrong, so both are asserted
 * against a fake socket rather than a recording.
 */

type Listener = (event: { readonly data?: unknown }) => void;

/** A WebSocket stand-in whose lifecycle the test drives. */
class FakeSocket {
  static readonly instances: FakeSocket[] = [];
  static readonly OPEN = 1;
  readonly OPEN = 1;
  readonly sent: string[] = [];
  readyState = 0;
  private readonly listeners: Record<string, Listener[]> = {};

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  addEventListener(type: string, fn: Listener): void {
    (this.listeners[type] ??= []).push(fn);
  }
  send(payload: string): void {
    this.sent.push(payload);
  }
  close(): void {
    this.readyState = 3;
    this.emit("close", {});
  }
  open(): void {
    this.readyState = 1;
    this.emit("open", {});
  }
  emit(type: string, event: { readonly data?: unknown }): void {
    for (const fn of this.listeners[type] ?? []) fn(event);
  }
}

const META = {
  meta: { universe: [{ name: "BTC", szDecimals: 5 }] },
  spotMeta: { universe: [], tokens: [] },
  allMids: { BTC: "86000.0" },
};

function fetchServing(responses: Record<string, unknown>, fail: { count: number }): typeof globalThis.fetch {
  return (async (_url: string, init?: { body?: string }) => {
    if (fail.count > 0) {
      fail.count--;
      throw new Error("offline");
    }
    const body = JSON.parse(init?.body ?? "{}") as { type: string };
    const payload = responses[body.type];
    if (payload === undefined) return { ok: false, status: 404, json: async () => ({}) } as Response;
    return { ok: true, status: 200, json: async () => payload } as Response;
  }) as unknown as typeof globalThis.fetch;
}

function start(fail: { count: number }): {
  events: FeedEvent[];
  stop: () => void;
  select: (coin: string, precision: Parameters<ReturnType<typeof createHyperliquidFeed>["select"]>[1]) => void;
} {
  const events: FeedEvent[] = [];
  const feed = createHyperliquidFeed({
    coin: "BTC",
    precision: undefined,
    fetch: fetchServing(META, fail),
    WebSocket: FakeSocket as unknown as typeof WebSocket,
  });
  const stop = feed.start((e) => events.push(e));
  return { events, stop, select: feed.select };
}

describe("boot failure", () => {
  it("retries a transient metadata failure instead of staying disconnected", async () => {
    vi.useFakeTimers();
    FakeSocket.instances.length = 0;
    const fail = { count: 1 };
    const { events, stop } = start(fail);

    await vi.advanceTimersByTimeAsync(10);
    expect(events.some((e) => e._tag === "connection" && e.event._tag === "closed")).toBe(true);
    expect(FakeSocket.instances.length, "no socket on the failed boot").toBe(0);

    // The venue comes back; the retry must reach a socket without a reload.
    await vi.advanceTimersByTimeAsync(5000);
    expect(FakeSocket.instances.length, "boot retried").toBeGreaterThan(0);
    stop();
    vi.useRealTimers();
  });
});

describe("grouping across a reconnect", () => {
  it("keeps the precision chosen while the socket was down", async () => {
    vi.useFakeTimers();
    FakeSocket.instances.length = 0;
    const { stop, select } = start({ count: 0 });
    await vi.advanceTimersByTimeAsync(10);
    const first = FakeSocket.instances[0];
    if (first === undefined) throw new Error("expected a socket");
    first.open();
    first.close();

    // Chosen while disconnected: desired state, not transport state.
    select("BTC", { _tag: "aggregated", nSigFigs: 3, mantissa: undefined });
    await vi.advanceTimersByTimeAsync(5000);

    const second = FakeSocket.instances[1];
    if (second === undefined) throw new Error("expected a reconnect");
    second.open();
    const books = second.sent.filter((m) => m.includes('"l2Book"'));
    expect(books.length, "both book streams resubscribed").toBe(2);
    for (const message of books) expect(message).toContain('"nSigFigs":3');
    stop();
    vi.useRealTimers();
  });
});
