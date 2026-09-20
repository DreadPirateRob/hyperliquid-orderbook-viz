# Proof Surface Design

Type: grilling
Status: resolved
Blocked by: 03

## Question

Decide the shape of the proof surface: JSONL fixture format (per-message envelope with receive timestamp) and repo location; which coins/durations to record; benchmark harness (Vitest bench vs custom runner) for synthetic bursts and for scripted render timing; how published numbers reach the README (generated table, machine spec recorded); the malformed / out-of-order / stale scenario list.

## Answer

1. **Fixture format**: one interleaved JSONL per recording. Header line `{"meta":{coin, nSigFigs, mantissa, szDecimals, startedAt, note}}`; then one line per socket message `{"rx":<client epoch ms>,"ch":"l2Book"|"bbo"|"trades"|"subscriptionResponse","data":<raw payload>}`; control lines `{"rx","ch":"control","data":{type: resubscribe|disconnect|reconnect, ...}}` so replay reproduces precision swaps and reconnects. Replay = fold over lines in `rx` order.
2. **Recordings** (3–5 min each, `fixtures/<name>.jsonl.gz`): `btc-perp-quiet`, `btc-perp-active`, `eth-perp`, `low-priced-perp` (HMSTR), `spot-pair` (HYPE/USDC), `btc-precision-swap` (two grouping changes), `btc-reconnect` (forced drop). Plus a **synthesised** `btc-grid-change` built by rescaling a real fixture across a power of ten, labelled synthetic. Recorder `scripts/record.ts`, shared with the later replay feature.
3. **Tests** (Vitest + fast-check): replay tests asserting invariants per step (sorted sides, uncrossed, on-grid, `Σconsumed + Σcancelled = Σdecreases`, monotone cumulative depth, one version bump per applied event, stable `snapshot()` refs); property tests (diff reconstructs the book; tick conversion round-trips; VWAP bounded by touched levels); scenario tests on malformed fixtures (duplicate push, non-monotonic `time`, garbage JSON, off-grid push, drop + reconnect, precision swap with in-flight old pushes) → expected transitions and `dropped` counts. React chrome: behaviour tests only (grouping click resubscribes; pair switch resets); no snapshot tests.
4. **Benchmarks**: engine burst via `vitest bench` at 1k/10k/50k/100k events/s × 10 s (mixed streams in observed proportions), measuring sustained events/s, p50/p99 `apply` latency, heap delta; **labelled synthetic**, headline framed as headroom over the ~30 events/s real feed. Render bench via Playwright headless Chromium: replay `btc-perp-active` 60 s per cadence mode, trails/tape on and off; fps, frame p50/p95, dropped, draw calls, heap. `scripts/bench.ts` writes `bench/results.json` (with CPU, browser, date) and regenerates a README table between markers. Benches run on demand, not in CI; results JSON is committed.
