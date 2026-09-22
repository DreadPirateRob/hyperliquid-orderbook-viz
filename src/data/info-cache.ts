import type { Fetch } from "./hyperliquid-info";

/**
 * The venue rate-limits `POST /info`, and the widget asks for the same few
 * payloads from several places (feed boot, pair list, top-bar stats). This
 * decorator makes those one request: identical bodies in flight share a
 * promise, successful answers are served from cache for a per-payload TTL,
 * and a rate-limited answer serves the last good body rather than failing.
 */

/** How long each payload stays fresh. The universe barely changes; prices do. */
const TTL_MS: Record<string, number> = {
  meta: 600_000,
  spotMeta: 600_000,
  metaAndAssetCtxs: 9000,
  allMids: 9000,
};
const DEFAULT_TTL_MS = 9000;
/** After a 429 the cached body is served for this long before trying again. */
const BACKOFF_MS = 30_000;

type Entry = {
  body: string;
  at: number;
  blockedUntil: number;
  inFlight: Promise<string> | undefined;
};

/**
 * Wrap a fetch so `/info` calls are deduplicated and cached.
 *
 * @param fetchFn - The underlying fetch.
 * @param now - Clock, injectable for tests.
 * @returns A fetch with the same contract.
 */
export function createInfoFetch(fetchFn: Fetch, now: () => number = Date.now): Fetch {
  const entries = new Map<string, Entry>();

  return (async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const body = typeof init?.body === "string" ? init.body : undefined;
    if (body === undefined) return fetchFn(url, init);
    const type = requestType(body);
    const ttl = TTL_MS[type] ?? DEFAULT_TTL_MS;
    const entry = entries.get(body);
    const t = now();
    if (entry !== undefined && (t - entry.at < ttl || t < entry.blockedUntil)) return cached(entry.body);
    if (entry?.inFlight !== undefined) return entry.inFlight.then(cached);

    const request = (async (): Promise<string> => {
      const response = await fetchFn(url, init);
      if (response.status === 429) {
        const previous = entries.get(body);
        if (previous === undefined) throw new Error("rate limited with no cached body");
        previous.blockedUntil = now() + BACKOFF_MS;
        previous.inFlight = undefined;
        return previous.body;
      }
      if (!response.ok) {
        const failed = entries.get(body);
        if (failed !== undefined) failed.inFlight = undefined;
        throw new Error(`info ${type}: ${response.status}`);
      }
      const text = await response.text();
      entries.set(body, { body: text, at: now(), blockedUntil: 0, inFlight: undefined });
      return text;
    })();

    entries.set(body, {
      body: entry?.body ?? "",
      at: entry?.at ?? Number.NEGATIVE_INFINITY,
      blockedUntil: entry?.blockedUntil ?? 0,
      inFlight: request,
    });
    return request.then(cached, (error: unknown) => {
      const failed = entries.get(body);
      if (failed !== undefined) failed.inFlight = undefined;
      throw error;
    });
  }) as unknown as Fetch;
}

function cached(body: string): Response {
  return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
}

function requestType(body: string): string {
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed === "object" && parsed !== null && "type" in parsed && typeof parsed.type === "string")
      return parsed.type;
  } catch {
    // A non-JSON body is not an `info` request; it simply has no TTL entry.
  }
  return "unknown";
}
