# Code review — Order Book Observatory

## Scope and verdict

Reviewed the current implementation from the first React scaffold (`1c319ab`) through `f0ccb79`, including the changes that were uncommitted when this review began. Those caption/layout/focus changes were committed as `f0ccb79` during the review. The requested comparison was `git diff 1c319ab^...HEAD`; because the first React attempt was abandoned, its actual merge-base with the current implementation is `4adea87`. Findings concern the current implementation, not the abandoned branch.

**Verdict:** the architecture is appropriate for a serious take-home, but the data-integrity and runtime-state defects below should be addressed before presenting it as finished. Additional frameworks, a Worker rewrite, or generic service abstractions are not the priority.

Standards and Spec were reviewed independently in parallel, with an additional security/reliability pass. Findings retain their axis below and are ordered P1–P3 as requested. Numbering is for reference, not a ranking between findings of the same priority.

- **P1:** high-severity correctness defect; fix before submission.
- **P2:** concrete behavior, reliability, or maintenance defect; prioritize before polishing.
- **P3:** lower-risk efficiency or evidence-quality improvement.
- **Executed evidence:** an in-memory Node probe exercised the real modules, using an in-memory TypeScript transform. Runtime probes supplied a synthetic feed, controlled clock, and recording/no-op Canvas interface. These are not browser visual tests.
- **Source-traced evidence:** the failure follows from the inspected control flow; it was not reproduced end-to-end.

Application files were not changed. No formatter, build, benchmark publisher, or project-wide test suite was run. This report is the only file written by the review. The employer's original assignment was not located; the Spec axis uses `.scratch/orderbook-widget/spec.md`, its decision tickets, and the ADRs.

## P1 — High severity

### 1. Pruning old trades corrupts consumed/cancelled attribution

**Axis:** Standards — correctness/data integrity. **Evidence:** executed.

**Location:** `src/data/attribution.ts:105-112,197-210`.

The per-price `bid` and `ask` arrays contain cumulative volumes. `prune()` removes their expired prefixes without preserving the removed cumulative baseline. A subsequent query whose lower bound precedes the first surviving entry subtracts zero, thereby counting expired trades again.

The real module produced:

```text
Trades: 100 units at t=0; 1 unit at t=16000
Query: split a loss of 200 over (15000,16000]
Before prune(16000): consumed=1,   cancelled=199
After  prune(16000): consumed=101, cancelled=99
Expected:           consumed=1,   cancelled=199
```

This changes the meaning of the observatory's core trade-versus-cancellation metrics merely because cleanup ran. It violates the adopted coding standards' correctness-first requirement, not a stylistic preference.

**Recommendation:** retain the cumulative baseline alongside a logical start cursor, or rebase surviving sums when compacting. Keep a regression covering partial pruning followed by a query starting before the first retained print. Also cover adding more trades after compaction.

**Resolution (fixed).** Reproduced first: a new test in `src/data/attribution.test.ts` failed with exactly the reported `consumed=101, cancelled=99`. `PriceBucket` now carries `base: { bid, ask }`, the cumulative totals already dropped; `prune()` records `cum[drop - 1]` before splicing and `volumeAt` starts from `base[side]` when the query's lower bound precedes the first surviving entry. Still O(log n). The regression covers a query starting before the first retained print and prints added after compaction.

## P2 — Behavior and reliability

### 2. Pause drops incoming data instead of freezing rendering

**Axis:** Spec. **Evidence:** executed.

**Location:** `src/widget/runtime.ts:150-169,184-198`.

The feed listener returns before `engine.apply()` for book/trade events while paused. Meanwhile, the frame callback continues sampling and painting. Thus the button neither preserves complete live ingestion nor actually freezes the picture's animations.

The probe started at mid 100, paused, and delivered a new book at mid 110. Painting continued with 42 `fillRect` calls during the paused frame. Resuming without another feed event still reported mid 100: the update was lost.

**Contract:** spec story 44, `.scratch/orderbook-widget/spec.md:74`: “pause (space) rendering while the feed keeps flowing.”

**Recommendation:** ingest regardless of pause; freeze the displayed sample/paint while paused, with an explicit bounded policy for presentation events. On resume, sample the current book and settle presentation rather than replaying the paused interval.

**Resolution (fixed).** The feed listener no longer filters on `state.paused`: every event is folded. The frame loop returns before sampling and painting while paused, holding the last frame, and sets `snapPending` so resuming settles instead of replaying the gap. Status still emits at 2 Hz through a shared `emitStatus`, so the connection dot and the HUD's live-snapshot lines stay current while paused. Measured: paint calls during 1.5 s paused went from 22,848 to **0**. Covered end to end by `pause freezes the picture while the feed keeps flowing`, which asserts the canvas pixels are identical while the HUD keeps changing, and README now states the contract.

### 3. Disabling overlays also disables independent HUD metrics

**Axis:** Spec. **Evidence:** executed.

**Location:** `src/widget/runtime.ts:225-233`; `src/state/sampler.ts:171`; `src/widget/hud.ts:29-40`.

The runtime supplies the metric source only when `overlaysOn` is true. Consequently, a visible metrics HUD loses pressure, churn, imbalance, execution cost, and other values when overlays are off. Responsive layout can also disable overlays while the user still wants metrics.

With unchanged book data, the probe went from share `50%` and a populated cost to `–` for share, cost, pressure, and churn after disabling overlays.

**Contract:** stories 32 and 34, spec lines 58–60: a HUD “with pressure, cancel ratios … execution cost” and a separate overlay toggle.

**Recommendation:** obtain HUD metrics when `metricsOn || overlaysOn`; independently gate the per-row overlay work. Keep the two user controls independent.

**Resolution (fixed).** `runtime.ts` now passes the engine when `state.overlaysOn || state.metricsOn`. Covered by `the metrics HUD keeps its numbers when overlays are off`, which turns overlays off with the HUD open and asserts pressure and churn still read numbers.

### 4. Settled “on update” mode ignores UI-only changes

**Axis:** Spec. **Evidence:** executed for redraw failure; source-traced for scheduling.

**Location:** `src/widget/runtime.ts:184-193,294-298`.

The early-return condition checks book version, animation movement, and hover dirtiness. `update(next)` changes the runtime state without invalidating that condition. Once motion settles, changing view, ruler, toggles, or HUD state need not paint until another feed event. The probe changed ladder to spine on a settled book and observed **zero paint calls**.

The loop also schedules another rAF before that early return, so it continues waking at display cadence even while doing no drawing.

**Contract:** story 15, spec line 35: “animation to stop between updates” so a quiet book costs no CPU; story 8, line 26, requires view switching.

**Recommendation:** track feed, UI, resize, and animation dirtiness explicitly. UI changes must request a frame. When settled in update mode, resume drawing from an actual change rather than continuously polling rAF. Keep necessary low-rate connection/status updates independent of paint skips.

### 5. Background tabs accumulate an unbounded presentation backlog

**Axis:** Standards — resource ownership/reliability. **Evidence:** executed at the engine seam; browser suspension path source-traced.

**Location:** `src/data/engine.ts:56-57,95-100,128-139,161-176`; `src/widget/runtime.ts:169-175,215-217`; `src/state/sampler.ts:93-98`.

Book lifecycle events, trades, and migrations wait for the frame callback to drain them. A hidden browser tab can suspend rAF while socket ingestion continues. Host ticks prune attribution but do not bound those presentation queues. Returning to the tab folds the entire backlog before snapping.

A probe delivered one trade per second and host ticks for 50 synthetic minutes without a presentation consumer. `drainTrades()` returned all **3,000 trades**, not a bounded recent window.

**Standard:** explicit resource ownership in the adopted coding standards; this also undermines the spec's hidden-tab “no catch-up animation” intent.

**Recommendation:** bound or coalesce presentation queues independently of rendering. Preserve the current engine book, retain only the presentation history actually needed, and define a reset/settle path on visibility return. Do not stop ingesting the feed as a shortcut.

### 6. The subscription gate cannot follow a lower price decade

**Axis:** Spec. **Evidence:** executed at the gate seam; live-feed integration source-traced.

**Location:** `src/data/hyperliquid-feed.ts:91-95,121-122,152,222-226`; `src/data/subscription-gate.ts:50-64`; `src/widget/runtime.ts:203-212`.

The gate's grid is derived from the startup REST mark, which is not updated. Runtime decade re-derivation changes the engine/presentation grid but not the feed gate. A valid finer-grid book after a downward decade crossing can therefore be discarded before reaching the runtime. Even `gate.select(samePrecision, newGrid)` returns `unchanged` without adopting the grid.

The gate probe acknowledged both streams at grid 10, requested the same precision at grid 1, and observed `unchanged` plus rejection of prices valid on the finer grid.

**Contract:** spec line 109: grouping is “re-derived when the mid's decade changes”; line 135 includes the grid-change scenario.

**Recommendation:** give current-grid conformance an explicit transition independent of precision identity, while retaining acknowledgment/in-flight-message protection. Exercise the live adapter path, not just engine fixture replay. The project's own notes correctly say a real venue decade crossing remains unobserved; this finding concerns the specified synthetic contract and demonstrated gate behavior, not a claim of a captured production incident.

### 7. Completed refill watches are counted repeatedly

**Axis:** Spec. **Evidence:** executed.

**Location:** `src/data/level-stats.ts:184-203,235-256`.

After `done` and `at5s` are set, every host tick appends the same completed watch to `refills` until the watch is removed after 35 seconds. Earlier completions acquire more weight than later ones. The five-minute median becomes a median of repeated samples rather than completed refill events, with unnecessary retention and sorting as well.

A probe completed three watches at **1,000 ms, 10,000 ms, and 10,000 ms**. The reported median was **1,000 ms**, not **10,000 ms**.

**Contract:** the metric definition in `.scratch/orderbook-widget/issues/06-derived-metrics-definitions.md:21`: “Per side: median refillTime over 5 min,” supporting spec story 32.

**Recommendation:** record each completed watch exactly once. Keep the overlay's display lifetime separate from the aggregate's completion record.

**Resolution (fixed).** `Watch` carries `recorded`; the aggregate is appended on the transition to complete and never again, while the overlay keeps showing the watch until its 35 s cleanup. Reproduced first in `src/data/level-stats.test.ts`: two completions at 1 s and 10 s reported a 1 s median before the fix, 10 s after.

### 8. Time-dependent metrics remain cached after their inputs change

**Axis:** Spec. **Evidence:** executed.

**Location:** `src/data/engine.ts:128-139,179-203`.

Host ticks advance time, prune attribution, and advance refill watches, but do not invalidate cached metrics unless connection state also changes. The cache is keyed by book mutation/notional, although pressure decay and rolling windows depend on time.

The probe reported pressure **8.7517** at t=1500 and still **8.7517** at t=2500. The engine's independently decayed field at t=2500 was **6.2709**. Similar invalidation gaps affect expiring churn/cancellation windows and newly completed watches.

**Contract:** spec line 54 and metric definition ticket line 19: the size-delta field decays with τ=3 seconds; metric windows and refill timing are specified at spec line 117. The additional “lazy on book version” wording is insufficient for those time-dependent inputs.

**Recommendation:** separate book-dependent and time-dependent cache validity, or invalidate the metric cache on relevant host ticks without forcing a full book snapshot rebuild.

**Resolution (fixed).** The metric cache is now keyed by book version _and_ `cachedAt === now`, so a host tick that advances the clock invalidates it without rebuilding the book. Reproduced first: pressure held at 4.0 across a 1 s gap with no pushes; it now decays with τ = 3 s.

### 9. Churn excludes additions and growth

**Axis:** Spec. **Evidence:** executed.

**Location:** `src/data/level-stats.ts:157-168,215-254`.

`change()` returns for `after >= before` before contributing to the buckets later used for churn. Those buckets model decreases for cancellation ratios, but are also reused for all churn. A book receiving additions/growth can therefore display zero activity.

A countable change from size 10 to 20 returned `eventChurn=0` and `volumeChurn=0`. Under the documented five-second formula, this one event contributes 0.2 events/s and 2 coin/s.

**Contract:** metric definition ticket line 17: `eventChurn = (added + vanished + grew + shrank) / W`; `volumeChurn = Σ|Δsize| / W`.

**Recommendation:** count all qualifying size changes for churn, while keeping decrease-only counters for cancellation ratios. Reuse time buckets if useful, but do not conflate their meanings.

**Resolution (fixed).** Buckets carry `churnCount`/`churnVolume` for every size change alongside the decrease-only `count`/`hits`/`consumed`/`cancelled` used by the cancellation ratios. A 10 to 20 growth now reports 0.2 events/s and 2 coin/s, and the cancel ratio still describes decreases only.

### 10. A transient metadata failure leaves the live feed permanently disconnected

**Axis:** Standards — expected-failure recovery. **Evidence:** source-traced.

**Location:** `src/data/hyperliquid-feed.ts:79-90,134-138`.

A failed initial metadata request emits rejected/closed and returns before creating a WebSocket. Reconnect scheduling exists only in the socket-close handler, so restoring connectivity does not recover this session. Separate statistics polling does not restart feed boot.

**Standard:** the adopted error-handling guidance requires the boundary to translate expected integration failures into a usable outcome. Here the UI is left disconnected without an automatic recovery or explicit retry path.

**Recommendation:** retry transient boot failures with a bounded delay and disposal cancellation, or expose a clear retry action. Do not retry permanent invalid-market errors indefinitely.

### 11. Grouping changes can disappear during reconnect

**Axis:** Standards — lifecycle correctness. **Evidence:** source-traced.

**Location:** `src/data/hyperliquid-feed.ts:121-122,146-159,171`.

After a socket closes, the previous gate remains. A grouping selection mutates that gate, but `resubscribe()` returns because the socket is not open, before updating the stored precision. The reconnect then creates a new gate from the old precision. The `wanted` path is used only when the gate is absent, so this normal disconnected state loses user intent.

**Standard:** correct-by-construction lifecycle state and explicit resource ownership; desired configuration should not be confused with acknowledged transport state.

**Recommendation:** preserve desired precision independently of the active subscription and adopt it on the next socket open. Cover selection before boot, during reconnect, and during pending acknowledgments through the same lifecycle model.

### 12. A blocked localStorage getter can prevent the app from mounting

**Axis:** Standards — boundary error handling. **Evidence:** source-traced.

**Location:** `src/main.tsx:34`; `src/state/prefs.ts:49-50,78-85`.

`globalThis.localStorage` is evaluated before entering `createPrefsStore`. Browser policy can throw `SecurityError` from that getter, bypassing the store's existing guarded reads. `main()` then rejects before React mounts, despite the store already supporting an undefined backend.

**Standard:** expected environment/persistence failures should be handled at the boundary; the prefs module explicitly states that bad preferences must not prevent rendering.

**Recommendation:** acquire browser storage inside a guarded boundary and pass `undefined` when unavailable. Retain the existing in-memory/default preference behavior. This is a robustness issue, not a demonstrated security exploit.

### 13. Corrupt compressed fixtures escape the declared Result contract

**Axis:** Standards — expected failures as values. **Evidence:** executed.

**Location:** `src/data/fixture-loader.ts:33-50`; `src/main.tsx:38-45,79`.

Fetch and `arrayBuffer()` errors are caught, but gzip decompression runs outside that boundary. A truncated gzip response makes the promise reject rather than returning the declared tagged error. The composition root only checks the returned Result, so it never reaches its “Fixture unavailable” display.

The probe supplied gzip magic bytes followed by invalid/truncated content and observed a rejected `TypeError`, not an error Result.

**Standard:** adopted coding standards, “Expected failures are values”; parser and adapter errors must remain inside the stated contract.

**Recommendation:** classify decompression/decoding failures at the fixture adapter boundary and return the appropriate tagged error. Keep a malformed compressed-input regression.

### 14. React state updater functions perform external side effects

**Axis:** Standards — React purity and embeddability. **Evidence:** source-traced; duplicate invocation not browser-reproduced in this review.

**Location:** `src/widget/order-book.tsx:131-159`; `src/main.tsx:52-66`.

The functional updaters call `report()` or `prefs.set()`. React can replay updater functions; development StrictMode intentionally invokes them more than once to expose impurity. One toggle can therefore produce duplicate `onStateChange` callbacks, URL writes, or preference notifications. An embedder whose callback updates parent state is also being invoked from React's update computation rather than the interaction boundary.

**Standard:** React guidance requires pure state updaters and event-driven parent notifications; ADR 0008 defines `onStateChange` as the reusable widget's outward seam.

**Recommendation:** compute the next state and publish the external notification once at the handler boundary; keep updater/reducer calculations pure. A small cohesive state transition is sufficient—no new state-management library is needed.

## P3 — Efficiency and proof quality

### 15. Tape P95 copies and sorts unchanged history every frame

**Axis:** Standards — performance. **Evidence:** source-traced; no measured user-visible slowdown claimed.

**Location:** `src/state/tape.ts:76-80`; `src/state/sampler.ts:171-173`.

Every sampled frame maps and sorts the five-minute print-size window to obtain P95, even when no trade arrived and even when the tape is not drawn. The 50-row display cap does not cap this separate historical window. The work scales with retained trade count rather than visible rows.

**Standard:** `docs/adr/0004-canvas-2d-worker-deferred.md:11` explicitly calls for no per-frame allocation. This is a concrete avoidable computation, not a request to pool every small object.

**Recommendation:** cache the threshold and recompute on new trades or expiration of the oldest relevant sample. Keep aging correct. Measure before considering a more complex order-statistics structure.

### 16. Published render benchmarks do not cover the promised proof matrix

**Axis:** Spec. **Evidence:** source-traced.

**Location:** `scripts/bench.ts:17,20-23,48`; `scripts/render-bench.ts:72-89`; `README.md:178-200`.

The harness runs two default 60-fps cases for 15 seconds, not the specified 60 seconds per cadence × trails/tape configuration × viewport. It does not establish behavior at 30 fps or on-update cadence. In addition, the published frame percentiles are medians of rolling HUD percentile samples, not percentiles over all frame durations in the full run; that distinction is not made explicit in the table.

**Contract:** `.scratch/orderbook-widget/spec.md:139`: “60 s per cadence × trails/tape on/off × two viewports.”

**Recommendation:** run the promised cases or explicitly narrow the proof claim and record that decision. Either collect full-run frame timings or label the rolling-summary statistic accurately. Keep emulated phone results labelled emulated, as they already are. Do not regenerate committed benchmark output during a read-only review.

## Standards

**8 findings: 1 P1, 6 P2, 1 P3.** Worst within this axis: trade-attribution pruning corrupts consumed/cancelled accounting.

The existing engine/state/render separation, exact raw-tick parsing, injectable feed seam, and localized external-store integration are useful foundations. The most valuable maintenance work is repairing ownership boundaries: desired versus active subscription state, ingestion versus presentation, event completion versus overlay lifetime, and pure React transitions versus outward notifications. Arbitrary file splitting, broad generic abstractions, new state libraries, or a Worker migration would not resolve these defects.

Baseline code smells were treated as judgement calls, not mandatory refactors. No additional smell-only findings were retained: concrete behavior and cost were stronger evidence than naming or file-size preferences.

## Spec

**8 findings: 0 P1, 7 P2, 1 P3.** Worst within this axis: pause violates the explicit ingest/render separation and loses updates; refill and churn calculations also violate their stated formulas.

Documented decisions were respected: the removed shape panel and spine's reclaimed trail/tape columns were not treated as missing features. The 10% migration-size tolerance was checked against the metric decision ticket and prototype and is not a bug despite shorter “equal-sized” wording in the spec. The one-versus-two-canvas discrepancy remains documentation/architecture reconciliation work, not a recommendation for an unmeasured rendering rewrite.

## Security and verification limits

No exploitable security vulnerability was substantiated by this review. The boundary findings above are reliability/resource issues. That is not a penetration-test result or a clean dependency audit: no dependency advisory scan, deployed-header check, or adversarial browser session was performed. Authentication, payment, and server authorization requirements should not be invented for this public read-only market viewer.

Executed probes covered attribution pruning, pause/resume, overlay/HUD independence, settled update-mode redraw, retained trade backlog, same-precision grid transition, duplicate refill aggregation, time-dependent cache validity, growth churn, and corrupt gzip handling. Transport boot/reconnect, blocked storage, and React updater replay findings are explicitly source-traced. No full-suite pass or browser visual verification is claimed.

The configured issue-tracker guide `docs/agents/issue-tracker.md` is absent. Run `/setup-matt-pocock-skills` if that review workflow should be fully configured; the local map and issue files supplied the requirements for this review.

**Summary: 16 findings — Standards 8 (worst: P1 attribution corruption); Spec 8 (worst: P2 pause/data-loss contract violation). Totals: 1 P1, 13 P2, 2 P3.**
