# 28: Tests hardening, benchmarks, README table

**What to build:** Scenario tests on broken copies (duplicate, non-monotonic, garbage, off-grid, drop + reconnect); engine burst bench and Playwright render bench; `scripts/bench.ts` → `bench/results.json` → README table; README with architecture diagram and ADR links.

**Blocked by:** 25, 27

**Status:** resolved

Type: task
Status: resolved
Blocked by: 25, 27

- [x] Benches labelled synthetic/emulated per ADR 0006
- [x] Mount/unmount ×20 leak test

**Working rules (every ticket):** `implement` skill; `coding-standards` + `typescript-best-practices` (+ `react-coding-style`, `react-best-practices` for chrome) applied to every line; TDD at the spec's seams; `tsc -b` and the touched test files after each step; one atomic commit per step (`<slice>: <step>`), full suite + `code-review` skill at the end of the ticket; visual tickets end with a **parity gate** (v4 and port side by side on the same live feed, screenshots per stage, user sign-off) and are never delegated to unattended agents. Nothing from `attempt/react-v1`.

## Answer

**Scenario tests** — `src/data/scenarios.test.ts` mutates a real recording and states what happens: a duplicated push is a content no-op with zero level events (the push is snapshot-authoritative); a non-monotonic push is applied as sent, because the feed carries no sequence to order by, and the invariants still hold; a garbage line fails the whole recording naming the line; a structurally wrong frame is dropped (`MalformedFrame`) and the book keeps its last good state; an off-grid price is refused by the wire layer (`OffGridPrice`), never folded in; `btc-reconnect` reports `DISCONNECTED` and comes back `LIVE` with a rebuilt book.

**Benches** — `scripts/burst.ts` (engine) and `scripts/render-bench.ts` (Playwright), driven by `scripts/bench.ts`, which writes `bench/results.json` and rewrites the README table between its markers. Burst rows are labelled **synthetic** and framed as a multiple of the ~30 events/s live feed; render rows are labelled **emulated** with viewport and DPR. Machine and date are recorded in the JSON and printed above the table.

**Two real defects the bench found, both fixed:**

1. The harness first omitted the host `tick`, so the engine never pruned its trade window: per-trade cost grew without bound. That was a harness bug — the runtime ticks every 500 ms — and is now part of the synthetic stream.
2. With that fixed, throughput still collapsed with rate. Root cause: the attribution join and the metric windows were **arrays that got scanned**. Prints are now indexed by price with per-side prefix sums and binary search (`volumeAt` is O(log n)); open decreases are indexed by price with a cursor, and only prices that just printed are re-joined; the 60 s ratio window is a ring of fixed 250 ms buckets, so a read is constant-cost and a late re-attribution is an O(1) bucket correction located by its timestamp; idle price entries are evicted. Result on this laptop (Ryzen 7 4700U): apply p50 went from rate-dependent milliseconds to a flat ~4 µs, and sustained throughput at a synthetic 100k events/s from 1,388 to 15,839 events/s.

There is a floor and it is stated in the README: a 15 s print window at 100k events/s inherently retains ~10⁶ prints, so above ~50k events/s the binding cost is allocation and GC, not lookup.

**Leak test** — `e2e/leak.spec.ts` counts window listeners, intervals, rAF handles and `ResizeObserver`s handed out and given back, mounts and unmounts the widget twenty times, then unmounts for good: intervals and observers return to zero, window listeners to at most one, DOM to zero widgets, and CDP-forced-GC heap growth stays under 12 MB.

**README** — rewritten as a feature guide: a screenshot per feature (ladder, top bar, trails and touch paths, overlays and hover, tape, spine, HUD, pair picker, settings, bottom sheet, phone), a Mermaid architecture diagram, the ADR index, a **Quirks we hit** section covering the venue (snapshots without sequence numbers, indistinguishable precisions, undocumented level ordering, the 60 s socket drop, the `/info` 429 storm, spot marks from `allMids`, unordered trades, decade grid changes), the engine's scaling wall and floor, and the browser (DPR vs CSS pixels, throttled hidden tabs, canvas icons, `display` beating `[hidden]`, fixture precision). Screenshots live in `docs/images/`.

**Two test-suite corrections:** the "no React commits at steady state" test settled the chrome first and now asserts the order of magnitude (≤ 3 commits against ~180 frames) rather than an exact count — the market list and the 10 s stats refresh are legitimate chrome commits; and the one test that must talk to the live venue (coin switch, which no recording can prove) may retry, since venue latency is not a defect here.

**Review** — reviewer subagents still rate-limited (429), so the two-axis review was run manually against the standards skills, as on tickets 22–27.

**Suites** — 150 Vitest, 17 Playwright, two consecutive clean full runs. Bench: `bench/results.json`, 60 fps at both benchmarked viewports with frame p50 2.4 ms (desktop 1500x820 DPR 1) and 1.2 ms (phone 390x844 DPR 3).
