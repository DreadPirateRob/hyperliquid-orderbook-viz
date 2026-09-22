# 23: Metric overlays and HUD

**What to build:** Size-delta strip, resiliency bar, migration connector, book-shape panel, and the metrics HUD (`m`) — engine metrics per Derived Metrics Definitions; v4's `fieldAdd/fieldNow`, `onDecrease/watchTick`, migration pairing, `cancelRatio`, `execCost`, `convexity`, `drawShapePanel`, HUD text. Deferred 600 ms attribution. Toggle `o`, URL `ovl`; notional pref.

**Blocked by:** 21, 22

**Status:** ready-for-agent

Type: task
Status: open
Blocked by: 21, 22

- [ ] Engine metrics tests: hand-built book cost, VWAP-bounded property, cancel ratio on the active BTC recording, convexity front-loaded vs flat, lazy on version
- [ ] HUD written by ref at 2 Hz; zero React commits at steady state
- [ ] Parity gate signed

**Working rules (every ticket):** `implement` skill; `coding-standards` + `typescript-best-practices` (+ `react-coding-style`, `react-best-practices` for chrome) applied to every line; TDD at the spec's seams; `tsc -b` and the touched test files after each step; one atomic commit per step (`<slice>: <step>`), full suite + `code-review` skill at the end of the ticket; visual tickets end with a **parity gate** (v4 and port side by side on the same live feed, screenshots per stage, user sign-off) and are never delegated to unattended agents. Nothing from `attempt/react-v1`.
