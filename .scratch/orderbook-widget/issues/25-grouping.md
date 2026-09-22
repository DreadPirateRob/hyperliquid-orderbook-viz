# 25: Grouping and precision change

**What to build:** Five per-coin grouping options (`$1 $2 $5 $10 $100`), segment + `[ ]`, URL `g`; change = unsubscribe both → reset → subscribe both with ack gate, on-grid check, queued changes; `RESYNCING` with freeze → dim → crossfade; decade change re-derives options.

**Blocked by:** 19

**Status:** ready-for-agent

Type: task
Status: resolved
Blocked by: 19

- [x] Adapter test on the precision-swap recording: ack sequencing, in-flight old pushes dropped
- [x] Grid-change fixture replay passes
- [x] Parity gate signed (transition feel)

**Working rules (every ticket):** `implement` skill; `coding-standards` + `typescript-best-practices` (+ `react-coding-style`, `react-best-practices` for chrome) applied to every line; TDD at the spec's seams; `tsc -b` and the touched test files after each step; one atomic commit per step (`<slice>: <step>`), full suite + `code-review` skill at the end of the ticket; visual tickets end with a **parity gate** (v4 and port side by side on the same live feed, screenshots per stage, user sign-off) and are never delegated to unattended agents. Nothing from `attempt/react-v1`.

## Answer

`data/subscription-gate.ts` isolates ADR 0007's two guards — per-stream ack gate, on-grid conformance (a push proves its own precision, so in-flight old pushes are dropped without trusting ack order), and serialisation of a change requested while another is pending — and is replayed against `btc-precision-swap` (two resubscribes, three grids, every accepted push on the then-active grid, old pushes dropped). The live adapter implements `select`: unsubscribe both books → announce the new market → subscribe both, all through the gate. Chrome gained the grouping segment derived from the mark, `[`/`]` stepping and the `g` URL param, with the pressed option following the request while the connection reads `RESYNCING`. The transition freezes the old ladder, dims it to 0.35 over 400 ms and fades the new grid in, so rows from two grids never mix. The runtime re-derives options and grid when the mid crosses a decade (v4 behaviour), pinned by the synthetic `btc-grid-change` replay (10 → 100 ticks across 100k) and a domain test. Fixed en route: `mark` never reached the feed session (options collapsed after a resubscribe) and a ticks-vs-quote-units mix-up in the decade check. **Parity gate passed** (`/tmp/group-1.png`, `/tmp/group-transition.png`, `/tmp/group-2.png`).
