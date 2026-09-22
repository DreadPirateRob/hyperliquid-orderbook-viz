# 20: Level motion: springs, pulses, persistence

**What to build:** Levels grow/shrink with springs, added/grew/ghost/fill pulses play, persistence saturates over 20 s — exactly v4's `hist`, `Spring`, `pulseState`, `heatColour`, `persistence`. Engine gains the one-pass diff → lifecycle events (`added|grew|shrank|vanished|outOfWindow`) with stream tags; trades stream subscribed for fill pulses (historical batch flagged).

**Blocked by:** 19

**Status:** ready-for-agent

Type: task
Status: resolved
Blocked by: 19

- [x] Engine diff property test: applying a snapshot reconstructs it; events sum to the diff
- [x] Sampler test with fake clock: spring settle, pulse values at known ages, state follows its price across a re-centre
- [x] Reduced motion snaps; hidden tab snaps on return
- [x] Parity gate signed

**Working rules (every ticket):** `implement` skill; `coding-standards` + `typescript-best-practices` (+ `react-coding-style`, `react-best-practices` for chrome) applied to every line; TDD at the spec's seams; `tsc -b` and the touched test files after each step; one atomic commit per step (`<slice>: <step>`), full suite + `code-review` skill at the end of the ticket; visual tickets end with a **parity gate** (v4 and port side by side on the same live feed, screenshots per stage, user sign-off) and are never delegated to unattended agents. Nothing from `attempt/react-v1`.

## Answer

`state/level-history.ts` is v4's `hist` in the state layer: per side:tick entry with `Spring(180,24)`, `first`/`lastChanged`/`live`/`prev`, ≤ 6 pulses pruned at 1.5 s, dead levels forgotten after 60 s, reduced-motion snap. The sampler folds drained engine events and live trades each frame, steps the history, and lays rows from it (`shown`, `prev`, `pulses`, `first`); a `settle` input snaps everything after folding (tab return); the anchor also snaps under reduced motion. `drawLadder` gained v4's pulse hunks (ghost from prev − live, add outline, fill marker + wash, grew flash) with `pulseState` decays 500/700/450/400 ms. Engine drains trades (`drainTrades`). Tests: history (springs, pulses, prune, prev semantics), sampler seam (settle, state follows price across re-centre, fill decay), engine diff property (fast-check: events reconstruct the book and sum to the diff), `pulseState` at known ages. Two-axis review applied. Prettier added mid-ticket (user request). **Parity gate passed** on the live BTC feed (`/tmp/parity-20-{port,v4}.png`).
