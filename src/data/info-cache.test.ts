import { describe, expect, it } from "vitest";
import { createInfoFetch } from "./info-cache";

function stubFetch(handler: (type: string) => Response) {
  const calls: string[] = [];
  const fn = (async (_url: string, init?: { body?: string }) => {
    const type = JSON.parse(init?.body ?? "{}").type as string;
    calls.push(type);
    return handler(type);
  }) as unknown as typeof globalThis.fetch;
  return { fn, calls };
}

const body = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });
const post = (type: string) =>
  ["https://api.hyperliquid.xyz/info", { method: "POST", body: JSON.stringify({ type }) }] as const;

describe("info cache", () => {
  it("serves repeated requests for the same payload from one call", async () => {
    const stub = stubFetch(() => body({ ok: 1 }));
    const fetchFn = createInfoFetch(stub.fn, () => 1000);
    const a = await (await fetchFn(...post("meta"))).json();
    const b = await (await fetchFn(...post("meta"))).json();
    expect(a).toEqual({ ok: 1 });
    expect(b).toEqual({ ok: 1 });
    expect(stub.calls).toEqual(["meta"]);
  });

  it("shares one in-flight request between concurrent callers", async () => {
    const stub = stubFetch(() => body({ ok: 1 }));
    const fetchFn = createInfoFetch(stub.fn, () => 1000);
    const [x, y] = await Promise.all([fetchFn(...post("allMids")), fetchFn(...post("allMids"))]);
    expect(await x.json()).toEqual({ ok: 1 });
    expect(await y.json()).toEqual({ ok: 1 });
    expect(stub.calls).toEqual(["allMids"]);
  });

  it("refetches prices after their short TTL but keeps the universe for minutes", async () => {
    const stub = stubFetch(() => body({ ok: 1 }));
    let now = 0;
    const fetchFn = createInfoFetch(stub.fn, () => now);
    await fetchFn(...post("allMids"));
    await fetchFn(...post("meta"));
    now = 10_000;
    await fetchFn(...post("allMids"));
    await fetchFn(...post("meta"));
    expect(stub.calls).toEqual(["allMids", "meta", "allMids"]);
  });

  it("serves the last good body while the venue rate-limits, then retries after the backoff", async () => {
    let limited = false;
    const stub = stubFetch(() => (limited ? new Response("", { status: 429 }) : body({ mark: 1 })));
    let now = 0;
    const fetchFn = createInfoFetch(stub.fn, () => now);
    await fetchFn(...post("allMids"));
    limited = true;
    now = 10_000;
    expect(await (await fetchFn(...post("allMids"))).json()).toEqual({ mark: 1 });
    now = 20_000;
    await fetchFn(...post("allMids"));
    expect(stub.calls, "the backoff stops a request storm").toEqual(["allMids", "allMids"]);
    limited = false;
    now = 60_000;
    await fetchFn(...post("allMids"));
    expect(stub.calls.length).toBe(3);
  });

  it("passes through requests that are not info calls", async () => {
    const stub = stubFetch(() => body({ ok: 1 }));
    const fetchFn = createInfoFetch(stub.fn, () => 0);
    const r = await fetchFn("https://example.test/thing");
    expect(r.ok).toBe(true);
  });
});
