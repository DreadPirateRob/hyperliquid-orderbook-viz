# 23: Metric overlays and HUD

**What to build:** Size-delta strip, resiliency bar, migration connector, book-shape panel, and the metrics HUD (`m`) — engine metrics per Derived Metrics Definitions; v4's `fieldAdd/fieldNow`, `onDecrease/watchTick`, migration pairing, `cancelRatio`, `execCost`, `convexity`, `drawShapePanel`, HUD text. Deferred 600 ms attribution. Toggle `o`, URL `ovl`; notional pref.

**Blocked by:** 21, 22

**Status:** ready-for-agent

Type: task
Status: resolved
Blocked by: 21, 22

- [x] Engine metrics tests: hand-built book cost, VWAP-bounded property, cancel ratio on the active BTC recording, convexity front-loaded vs flat, lazy on version
- [x] HUD written by ref at 2 Hz; zero React commits at steady state
- [x] Parity gate signed

**Working rules (every ticket):** `implement` skill; `coding-standards` + `typescript-best-practices` (+ `react-coding-style`, `react-best-practices` for chrome) applied to every line; TDD at the spec's seams; `tsc -b` and the touched test files after each step; one atomic commit per step (`<slice>: <step>`), full suite + `code-review` skill at the end of the ticket; visual tickets end with a **parity gate** (v4 and port side by side on the same live feed, screenshots per stage, user sign-off) and are never delegated to unattended agents. Nothing from `attempt/react-v1`.

## Answer

Data layer: `data/attribution.ts` (consumed/cancelled temporal join with v4's 600 ms deferred re-attribution and a 15 s print ring), `data/level-stats.ts` (size-delta field τ 3 s, per-side event window for churn and cancel ratios, resiliency watches ≥50 % loss → 80 % refill, cap 30 s), `data/metrics.ts` (execution cost, convexity), engine `metrics(notional)` cached per version and notional, plus migration pairing on the fast stream and `field`/`watch`/`drainMigrations` for the overlays. State layer carries `field`, `watch`, `migrations` and `metrics` on the frame; `maxField` normalises the strip. Render: field strip, resiliency bar, dashed migration connectors. Chrome: HUD `<pre>` written by ref at 2 Hz, `m` mounts it, `o` toggles overlays with the `ovl` URL param. Proof: hand-built execution cost, fast-check VWAP-bounds property, whole-recording ranges for cancel ratio/pressure/cost, convexity front-loaded vs flat, caching identity, HUD formatting (including the ADR 0005 naming rule), and an E2E using React's `Profiler` showing zero commits while the HUD keeps updating. Two defects found at the gate and fixed: the HUD panel was always in the layout because a `display` rule beat `[hidden]` (it is now mounted only while metrics are on), and the engine never received the price scale so execution cost read `–*`. **The book-shape panel was dropped at the user's request** — its curve data (`SideMetrics.shape`, `cumulativeCurve`) was removed with it; convexity remains as a number in the HUD. **Parity gate passed** (`/tmp/parity-23-{port,v4}.png`).
