# 20: Level motion: springs, pulses, persistence

**What to build:** Levels grow/shrink with springs, added/grew/ghost/fill pulses play, persistence saturates over 20 s — exactly v4's `hist`, `Spring`, `pulseState`, `heatColour`, `persistence`. Engine gains the one-pass diff → lifecycle events (`added|grew|shrank|vanished|outOfWindow`) with stream tags; trades stream subscribed for fill pulses (historical batch flagged).

**Blocked by:** 19

**Status:** ready-for-agent

Type: task
Status: open
Blocked by: 19

- [ ] Engine diff property test: applying a snapshot reconstructs it; events sum to the diff
- [ ] Sampler test with fake clock: spring settle, pulse values at known ages, state follows its price across a re-centre
- [ ] Reduced motion snaps; hidden tab snaps on return
- [ ] Parity gate signed

**Working rules (every ticket):** `implement` skill; `coding-standards` + `typescript-best-practices` (+ `react-coding-style`, `react-best-practices` for chrome) applied to every line; TDD at the spec's seams; `tsc -b` and the touched test files after each step; one atomic commit per step (`<slice>: <step>`), full suite + `code-review` skill at the end of the ticket; visual tickets end with a **parity gate** (v4 and port side by side on the same live feed, screenshots per stage, user sign-off) and are never delegated to unattended agents. Nothing from `attempt/react-v1`.
