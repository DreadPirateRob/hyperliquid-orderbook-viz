import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FIXTURES } from "./fixture-catalog";

describe("fixture quick links", () => {
  it("offers exactly the recordings that are served", () => {
    const served = readdirSync("public/fixtures")
      .filter((f) => f.endsWith(".jsonl.gz"))
      .map((f) => f.replace(/\.jsonl\.gz$/, ""))
      .toSorted();
    // A quick link to a missing recording is a broken demo, and a recording
    // with no quick link is invisible; the list and the directory must match.
    expect(FIXTURES.map((f) => f.name).toSorted()).toEqual(served);
  });

  it("describes every recording", () => {
    for (const f of FIXTURES) expect(f.label.length, f.name).toBeGreaterThan(0);
  });
});
