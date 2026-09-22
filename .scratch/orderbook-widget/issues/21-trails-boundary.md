# 21: Trails and boundary overlay

**What to build:** 12 s per-level trails glide continuously beside the ladder; bid/ask price paths with tags; 1 px boundary line; last-trade tag on the price column; stacked share bar in the gutter — v4's `trailStrip`, `midTrail`, `ribbon1`, `shareBar`. Trails toggle (`t`, URL `trails`).

**Blocked by:** 20

**Status:** ready-for-agent

Type: task
Status: open
Blocked by: 20

- [ ] Sampler test: trail sampling at 250 ms, window 12 s, path y from BBO, scroll fraction between samples
- [ ] Last trade direction from the trades stream
- [ ] Parity gate signed

**Working rules (every ticket):** `implement` skill; `coding-standards` + `typescript-best-practices` (+ `react-coding-style`, `react-best-practices` for chrome) applied to every line; TDD at the spec's seams; `tsc -b` and the touched test files after each step; one atomic commit per step (`<slice>: <step>`), full suite + `code-review` skill at the end of the ticket; visual tickets end with a **parity gate** (v4 and port side by side on the same live feed, screenshots per stage, user sign-off) and are never delegated to unattended agents. Nothing from `attempt/react-v1`.
