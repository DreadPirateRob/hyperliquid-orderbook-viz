# 22: Trades tape

**What to build:** Tape column with aggregation per block/price/side, `×n`, age, direction arrows, P95 outlier highlight, enter flash, 60 s fade — v4's `applyTrades`/`tapeP95`/`drawTape`. Toggle `p`, URL `tape`.

**Blocked by:** 20

**Status:** ready-for-agent

Type: task
Status: resolved
Blocked by: 20

- [x] Sampler test: aggregation, cap 50, P95 threshold needs ≥ 20 prints
- [x] Parity gate signed

**Working rules (every ticket):** `implement` skill; `coding-standards` + `typescript-best-practices` (+ `react-coding-style`, `react-best-practices` for chrome) applied to every line; TDD at the spec's seams; `tsc -b` and the touched test files after each step; one atomic commit per step (`<slice>: <step>`), full suite + `code-review` skill at the end of the ticket; visual tickets end with a **parity gate** (v4 and port side by side on the same live feed, screenshots per stage, user sign-off) and are never delegated to unattended agents. Nothing from `attempt/react-v1`.

## Answer

`state/tape.ts` is v4's tape store: prints aggregated per venue block + price + side with `×n`, direction against the previous print, cap 50 newest-first, and `outlierSize` = P95 of print sizes over five minutes (Infinity below 20 prints). The sampler feeds it and carries `tape`/`tapeOutlier` in the frame. `render/tape.ts` is v4's `drawTape`: 200 px column, header, 18 px rows, arrow glyph slot, amber outliers, enter flash `e^(−age/350)`, size bar `0.18+0.25·rel` to 60 px, fade `max(0.35, 1−age/60 s)`. Chrome: `p` key and button, `tape=0` URL param. Also fixed while diffing v4: `reset("grid")` (grouping change) keeps tape and touch trail as v4's `resetLadder` does, only `reset("coin")` clears them — ticket 25 depends on this. Tests: tape store (aggregation, direction, cap, P95 window), sampler reset scope. Review was done manually against v4's source because both reviewer subagents failed with an account rate limit (429, retry-after ≈ 4 days). **Parity gate passed** on the live BTC feed (`/tmp/parity-22-{port,v4}.png`).
