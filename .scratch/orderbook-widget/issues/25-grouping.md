# 25: Grouping and precision change

**What to build:** Five per-coin grouping options (`$1 $2 $5 $10 $100`), segment + `[ ]`, URL `g`; change = unsubscribe both → reset → subscribe both with ack gate, on-grid check, queued changes; `RESYNCING` with freeze → dim → crossfade; decade change re-derives options.

**Blocked by:** 19

**Status:** ready-for-agent

Type: task
Status: open
Blocked by: 19

- [ ] Adapter test on the precision-swap recording: ack sequencing, in-flight old pushes dropped
- [ ] Grid-change fixture replay passes
- [ ] Parity gate signed (transition feel)

**Working rules (every ticket):** `implement` skill; `coding-standards` + `typescript-best-practices` (+ `react-coding-style`, `react-best-practices` for chrome) applied to every line; TDD at the spec's seams; `tsc -b` and the touched test files after each step; one atomic commit per step (`<slice>: <step>`), full suite + `code-review` skill at the end of the ticket; visual tickets end with a **parity gate** (v4 and port side by side on the same live feed, screenshots per stage, user sign-off) and are never delegated to unattended agents. Nothing from `attempt/react-v1`.
