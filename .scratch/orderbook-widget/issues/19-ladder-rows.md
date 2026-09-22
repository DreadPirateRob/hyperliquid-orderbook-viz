# 19: Ladder rows on screen

**What to build:** Open the demo on BTC and see v4's static ladder: price column with round-number emphasis, heat cells, blocks with quantity labels, stepped depth profile, ruler lines with Σ, rows outside the ruler dimmed, anchored on the mid with hysteresis. Thin path: socket adapter (subscribe slow+fast+bbo, ping, ack gate) → engine book fusion by window authority (no lifecycle yet) → sampler rows/anchor/ruler/cum (`sample`) → `drawLadder` static parts → canvas mounted once in React → fixture reader for the E2E.

**Blocked by:** 18

**Status:** ready-for-agent

Type: task
Status: claimed
Blocked by: 18

- [ ] Fixture reader + socket adapter implement one feed-source contract; errors as tagged values
- [ ] Engine: typed-array sides, fusion, `snapshot()`; fixture→engine replay test over all eight recordings with sorted/cum invariants
- [ ] Sampler: rows keyed by price around a spring anchor (k40/c13, 30 % band); facts→sample test pins anchor behaviour
- [ ] E2E: `<OrderBook feed={reader}>` reaches LIVE and paints rows
- [ ] Parity gate signed

**Working rules (every ticket):** `implement` skill; `coding-standards` + `typescript-best-practices` (+ `react-coding-style`, `react-best-practices` for chrome) applied to every line; TDD at the spec's seams; `tsc -b` and the touched test files after each step; one atomic commit per step (`<slice>: <step>`), full suite + `code-review` skill at the end of the ticket; visual tickets end with a **parity gate** (v4 and port side by side on the same live feed, screenshots per stage, user sign-off) and are never delegated to unattended agents. Nothing from `attempt/react-v1`.
