import { describe, expect, it } from "vitest";
import type { Trade } from "../data/feed-events.types";
import * as Tick from "../domain/tick";
import { createTape } from "./tape";

function tick(n: number): Tick.Tick {
  const r = Tick.fromInteger(n);
  if (r._tag === "err") throw r.error;
  return r.value;
}
function trade(px: number, sz: number, side: "B" | "A", time: number): Trade {
  return { px: tick(px), sz, side, time };
}

describe("tape", () => {
  it("aggregates prints of the same block, price and side into one row", () => {
    const tape = createTape();
    tape.apply([trade(1000, 1, "B", 5), trade(1000, 2, "B", 5)], 100);
    expect(tape.rows()).toEqual([{ px: 1000, sz: 3, side: "B", n: 2, time: 5, rx: 100, dir: 0 }]);
    tape.apply([trade(1000, 1, "B", 6)], 200);
    expect(tape.rows().length, "a new block starts a new row").toBe(2);
    tape.apply([trade(1000, 1, "A", 6)], 300);
    expect(tape.rows().length, "the other side starts a new row").toBe(3);
    expect(tape.rows()[0]?.side).toBe("A");
  });

  it("records the direction of each print against the previous price", () => {
    const tape = createTape();
    tape.apply([trade(1000, 1, "B", 1)], 100);
    tape.apply([trade(1010, 1, "B", 2)], 200);
    tape.apply([trade(1005, 1, "A", 3)], 300);
    expect(tape.rows().map((r) => [r.px, r.dir])).toEqual([
      [1005, -1],
      [1010, 1],
      [1000, 0],
    ]);
  });

  it("keeps at most 50 rows, newest first", () => {
    const tape = createTape();
    for (let i = 0; i < 60; i++) tape.apply([trade(1000 + i, 1, "B", i)], i);
    const rows = tape.rows();
    expect(rows.length).toBe(50);
    expect(rows[0]?.px).toBe(1059);
    expect(rows.at(-1)?.px).toBe(1010);
  });

  it("reports the P95 print size only once 20 prints are in the 5 min window", () => {
    const tape = createTape();
    for (let i = 0; i < 19; i++) tape.apply([trade(1000, i + 1, "B", i)], i);
    expect(tape.outlierSize(19)).toBe(Number.POSITIVE_INFINITY);
    tape.apply([trade(1000, 20, "B", 19)], 19);
    // sizes 1..20 sorted; index floor(0.95 * 19) = 18 → 19
    expect(tape.outlierSize(19)).toBe(19);
    // sizes older than five minutes stop counting
    for (let i = 0; i < 20; i++) tape.apply([trade(1000, 2, "B", 1000 + i)], 300_001 + i);
    expect(tape.outlierSize(300_020)).toBe(2);
  });

  it("clears on reset", () => {
    const tape = createTape();
    tape.apply([trade(1000, 1, "B", 1)], 1);
    tape.clear();
    expect(tape.rows()).toEqual([]);
    expect(tape.outlierSize(1)).toBe(Number.POSITIVE_INFINITY);
  });
});
