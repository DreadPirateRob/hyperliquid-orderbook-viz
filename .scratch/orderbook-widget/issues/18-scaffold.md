# 18: Scaffold and contracts

**What to build:** Repo builds, lints, typechecks and tests with the agreed stack; the three layers exist as directories with their seam types only where v4 has a seam: feed events, engine pull API, frame sample, draw. Branded `Tick` + exact px parser as the first domain module (TDD, property test).

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

Type: task
Status: claimed
Blocked by: None (can start immediately)

- [ ] Vite 8 + React 19 + TS strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`) + Vitest + fast-check + Zod 4 + oxlint; scripts `dev/build/lint/typecheck/test/bench`
- [ ] `Tick` domain module: parse px string → integer tick exactly (no float round-trip), format back; fast-check round-trip property passes
- [ ] Local `Result` + tagged errors + `casesHandled` helpers in one explicit module (no better-result/Effect in repo)
- [ ] `prototype/` git-ignored; `index.html` mounts an empty `<OrderBook>`

**Working rules (every ticket):** `implement` skill; `coding-standards` + `typescript-best-practices` (+ `react-coding-style`, `react-best-practices` for chrome) applied to every line; TDD at the spec's seams; `tsc -b` and the touched test files after each step; one atomic commit per step (`<slice>: <step>`), full suite + `code-review` skill at the end of the ticket; visual tickets end with a **parity gate** (v4 and port side by side on the same live feed, screenshots per stage, user sign-off) and are never delegated to unattended agents. Nothing from `attempt/react-v1`.
