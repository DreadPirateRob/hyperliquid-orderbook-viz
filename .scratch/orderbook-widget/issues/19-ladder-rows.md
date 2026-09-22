# 19: Ladder rows on screen

**What to build:** Open the demo on BTC and see v4's static ladder: price column with round-number emphasis, heat cells, blocks with quantity labels, stepped depth profile, ruler lines with Σ, rows outside the ruler dimmed, anchored on the mid with hysteresis. Thin path: socket adapter (subscribe slow+fast+bbo, ping, ack gate) → engine book fusion by window authority (no lifecycle yet) → sampler rows/anchor/ruler/cum (`sample`) → `drawLadder` static parts → canvas mounted once in React → fixture reader for the E2E.

**Blocked by:** 18

**Status:** ready-for-agent

Type: task
Status: resolved
Blocked by: 18

- [x] Fixture reader + socket adapter implement one feed-source contract; errors as tagged values
- [x] Engine: typed-array sides, fusion, `snapshot()`; fixture→engine replay test over all eight recordings with sorted/cum invariants
- [x] Sampler: rows keyed by price around a spring anchor (k40/c13, 30 % band); facts→sample test pins anchor behaviour
- [x] E2E: `<OrderBook feed={reader}>` reaches LIVE and paints rows
- [x] Parity gate signed

**Working rules (every ticket):** `implement` skill; `coding-standards` + `typescript-best-practices` (+ `react-coding-style`, `react-best-practices` for chrome) applied to every line; TDD at the spec's seams; `tsc -b` and the touched test files after each step; one atomic commit per step (`<slice>: <step>`), full suite + `code-review` skill at the end of the ticket; visual tickets end with a **parity gate** (v4 and port side by side on the same live feed, screenshots per stage, user sign-off) and are never delegated to unattended agents. Nothing from `attempt/react-v1`.

## Answer

Thin path landed in 13 atomic commits: `domain/grouping.ts` (v4 candidates → grid in raw ticks, labels) and `Tick.formatOnGrid`; `data/wire.ts` (Zod parser shared by both feeds, bids-desc/asks-asc asserted, off-grid prices rejected); `data/engine.ts` (typed-array sides, window-authority fusion, level events from the merge pass, LIVE/STALE on host ticks); `data/fixture.ts` + `fixture-feed.ts` + `fixture-loader.ts` (recording parser, wall-clock replay with control lines, gzip-by-magic-bytes loader); `data/hyperliquid-info.ts` + `hyperliquid-feed.ts` (REST meta/allMids, four subscriptions, ping, reconnect, per-stream ack gate); `state/spring.ts` + `state/sampler.ts` (v4 `sample`: rows on grid, anchor k40/c13 with 30 % band, ruler, cum, share/micro); `render/palette.ts` + `render/ladder.ts` (static `drawLadder`); `widget/runtime.ts` + `OrderBook` (loop with v4 cadences, resize, host ticks, status by ref) and `?fixture=` demo. Tests: 41 Vitest (replay invariants over all eight recordings, fusion rules, sampler maths, feed timing) + 2 Playwright E2E on the injected fixture feed. Two-axis review applied. ADR 0007 amended: fast/bbo window runs from the touch. **Parity gate passed** by the user on the live BTC feed (`/tmp/parity-19-{port,v4}.png`); expected gaps are persistence/springs (20), trails/boundary (21), tape (22), overlays (23). Note for 25: the synthetic `btc-grid-change` recording is off its declared grid and drifts; the replay test skips grid/cross checks for synthetic recordings.
