# 21: Trails and boundary overlay

**What to build:** 12 s per-level trails glide continuously beside the ladder; bid/ask price paths with tags; 1 px boundary line; last-trade tag on the price column; stacked share bar in the gutter — v4's `trailStrip`, `midTrail`, `ribbon1`, `shareBar`. Trails toggle (`t`, URL `trails`).

**Blocked by:** 20

**Status:** ready-for-agent

Type: task
Status: resolved
Blocked by: 20

- [x] Sampler test: trail sampling at 250 ms, window 12 s, path y from BBO, scroll fraction between samples
- [x] Last trade direction from the trades stream
- [x] Parity gate signed

**Working rules (every ticket):** `implement` skill; `coding-standards` + `typescript-best-practices` (+ `react-coding-style`, `react-best-practices` for chrome) applied to every line; TDD at the spec's seams; `tsc -b` and the touched test files after each step; one atomic commit per step (`<slice>: <step>`), full suite + `code-review` skill at the end of the ticket; visual tickets end with a **parity gate** (v4 and port side by side on the same live feed, screenshots per stage, user sign-off) and are never delegated to unattended agents. Nothing from `attempt/react-v1`.

## Answer

State layer: `level-history.sampleTrails` and the sampler's `midTrail` sample every 250 ms over a 12 s window (`state/trail.ts` owns `TRAIL_MS`/`TRAIL_DT`/`pruneBefore`); the sampler also tracks the last print and its direction. Render: `trailStrip` (tiles positioned by time via `trailX`, clamped to the column, v4's alpha curve, white dots only for live prints — decreases now carry a `consumed` pulse kind), touch paths with now-edge tags (`yOf` interpolates a BBO finer than the grid), and `ribbon1` — boundary line, last-trade tag on the price column, stacked share bar with both sizes. Chrome: `t` key and button toggle trails, `trails=0` in the URL through `onStateChange` + `replaceState`. Tests: sampler (250 ms cadence, 12 s window, last-trade direction), render (`trailX` scroll fraction, `yOf` interpolation, `pulseState` incl. consumed). Two-axis review applied (React effect/handler split, shared constants, native `roundRect`). **Parity gate passed** on the live BTC feed (`/tmp/parity-21-port{,-notrails}.png`, `/tmp/parity-21-v4.png`).
