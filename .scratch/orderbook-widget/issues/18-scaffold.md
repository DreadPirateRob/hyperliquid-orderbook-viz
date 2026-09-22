# 18: Scaffold and contracts

**What to build:** Repo builds, lints, typechecks and tests with the agreed stack; the three layers exist as directories with their seam types only where v4 has a seam: feed events, engine pull API, frame sample, draw. Branded `Tick` + exact px parser as the first domain module (TDD, property test).

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

Type: task
Status: resolved
Blocked by: None (can start immediately)

- [x] Vite 8 + React 19 + TS strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`) + Vitest + fast-check + Zod 4 + oxlint; scripts `dev/build/lint/typecheck/test/bench`
- [x] `Tick` domain module: parse px string → integer tick exactly (no float round-trip), format back; fast-check round-trip property passes
- [x] Local `Result` + tagged errors + `casesHandled` helpers in one explicit module (no better-result/Effect in repo)
- [x] `prototype/` git-ignored; `index.html` mounts an empty `<OrderBook>`

**Working rules (every ticket):** `implement` skill; `coding-standards` + `typescript-best-practices` (+ `react-coding-style`, `react-best-practices` for chrome) applied to every line; TDD at the spec's seams; `tsc -b` and the touched test files after each step; one atomic commit per step (`<slice>: <step>`), full suite + `code-review` skill at the end of the ticket; visual tickets end with a **parity gate** (v4 and port side by side on the same live feed, screenshots per stage, user sign-off) and are never delegated to unattended agents. Nothing from `attempt/react-v1`.

## Answer

Scaffold landed in seven atomic commits on `master` (`6e8ce57`…): toolchain (Vite 8.3, React 19.3, TS 7 strict with all four flags, Vitest 5, fast-check 4, Zod 4, oxlint), scripts `dev/build/preview/lint/typecheck/test/bench`, `prototype/` ignored; `src/shared/result.ts` (Result, ok/err, casesHandled, shouldNeverHappen); `src/domain/tick.ts` (branded `Tick`, `makeScale` → Result, exact `parse`/`format`, `fromInteger`) with `tick.arbitrary.ts` and a round-trip property covering zero; seam types `src/data/feed-events.ts` (FeedEvent incl. host `tick`, Precision union, Subscription, FeedSource port), `src/data/engine-api.ts` (Engine `apply/snapshot/drain/metrics/reset`, LevelEvent, Metrics), `src/state/frame-sample.ts` (v4's `S`), `src/render/draw.ts`; `index.html` mounts an empty `<OrderBook coin="BTC">` with v4's palette as CSS variables. Verified: `tsc -b`, `oxlint src`, `vitest run` (9 tests), `vite build`, and a headless smoke against `vite preview` (mounted, bg `rgb(11,14,17)`). Two-axis `code-review` run; fixed: `makeScale` parses `szDecimals` (InvalidScale), `metrics()` added to the engine seam, host `tick` event, `Precision` as tagged union, `DepthStream` named. Deferred: venue/local timestamp brands (no realistic mix yet); FrameSample tape/trail/M fields arrive with their tickets.
