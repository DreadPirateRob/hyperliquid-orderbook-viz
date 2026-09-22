# 22: Trades tape

**What to build:** Tape column with aggregation per block/price/side, `×n`, age, direction arrows, P95 outlier highlight, enter flash, 60 s fade — v4's `applyTrades`/`tapeP95`/`drawTape`. Toggle `p`, URL `tape`.

**Blocked by:** 20

**Status:** ready-for-agent

Type: task
Status: claimed
Blocked by: 20

- [ ] Sampler test: aggregation, cap 50, P95 threshold needs ≥ 20 prints
- [ ] Parity gate signed

**Working rules (every ticket):** `implement` skill; `coding-standards` + `typescript-best-practices` (+ `react-coding-style`, `react-best-practices` for chrome) applied to every line; TDD at the spec's seams; `tsc -b` and the touched test files after each step; one atomic commit per step (`<slice>: <step>`), full suite + `code-review` skill at the end of the ticket; visual tickets end with a **parity gate** (v4 and port side by side on the same live feed, screenshots per stage, user sign-off) and are never delegated to unattended agents. Nothing from `attempt/react-v1`.
