import type { Result } from "../shared/result";
import { err } from "../shared/result";
import type { Fixture, MalformedFixture } from "./fixture";
import { parseFixture } from "./fixture";
import type { Fetch } from "./hyperliquid-info";
import type * as Tick from "../domain/tick";

/**
 * Outbound adapter that fetches a recording in the browser. Static hosts
 * may serve `.gz` with `Content-Encoding: gzip` (already inflated by the
 * browser) or as opaque bytes; the gzip magic bytes decide, not the name.
 */

/** The recording could not be fetched. */
export class FixtureUnavailable extends Error {
  readonly _tag = "FixtureUnavailable" as const;

  constructor(
    readonly url: string,
    override readonly cause: unknown,
  ) {
    super(`Fixture ${url} unavailable`);
  }
}

/**
 * Fetch and parse a recording.
 *
 * @param url - Where the `.jsonl` or `.jsonl.gz` lives.
 * @param fetchFn - The fetch implementation.
 * @returns The fixture or a tagged error.
 */
export async function loadFixture(
  url: string,
  fetchFn: Fetch,
): Promise<Result<Fixture, FixtureUnavailable | MalformedFixture | Tick.InvalidScale>> {
  let buffer: ArrayBuffer;
  try {
    const res = await fetchFn(url);
    if (!res.ok) return err(new FixtureUnavailable(url, res.status));
    buffer = await res.arrayBuffer();
  } catch (cause) {
    return err(new FixtureUnavailable(url, cause));
  }
  const head = new Uint8Array(buffer, 0, Math.min(2, buffer.byteLength));
  const gzip = head[0] === 0x1f && head[1] === 0x8b;
  const text = gzip
    ? await new Response(new Blob([buffer]).stream().pipeThrough(new DecompressionStream("gzip"))).text()
    : new TextDecoder().decode(buffer);
  return parseFixture(text);
}
