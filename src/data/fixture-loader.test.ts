import { describe, expect, it } from "vitest";
import { loadFixture } from "./fixture-loader";

/**
 * The loader is an adapter boundary: every expected failure — transport,
 * status, decoding — has to come back as a value, because the composition
 * root only ever inspects the Result.
 */

function serving(bytes: Uint8Array): typeof globalThis.fetch {
  return (async () =>
    ({
      ok: true,
      status: 200,
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    }) as Response) as unknown as typeof globalThis.fetch;
}

describe("loadFixture", () => {
  it("returns a tagged error for a corrupt gzip body instead of rejecting", async () => {
    // Gzip magic bytes, then rubbish: the stream fails mid-decode.
    const corrupt = new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 1, 2, 3, 4, 5, 6, 7, 8]);
    const r = await loadFixture("/fixtures/broken.jsonl.gz", serving(corrupt));
    expect(r._tag).toBe("err");
    if (r._tag === "err") expect(r.error._tag).toBe("FixtureUnavailable");
  });

  it("returns a tagged error for a body that is not a recording", async () => {
    const r = await loadFixture("/fixtures/plain.jsonl", serving(new TextEncoder().encode("not a fixture")));
    expect(r._tag).toBe("err");
    if (r._tag === "err") expect(r.error._tag).toBe("MalformedFixture");
  });

  it("returns a tagged error when the request fails", async () => {
    const failing = (async () => {
      throw new Error("offline");
    }) as unknown as typeof globalThis.fetch;
    const r = await loadFixture("/fixtures/any.jsonl.gz", failing);
    expect(r._tag).toBe("err");
    if (r._tag === "err") expect(r.error._tag).toBe("FixtureUnavailable");
  });
});
