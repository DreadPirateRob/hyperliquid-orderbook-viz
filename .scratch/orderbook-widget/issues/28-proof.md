# 28: Tests hardening, benchmarks, README table

**What to build:** Scenario tests on broken copies (duplicate, non-monotonic, garbage, off-grid, drop + reconnect); engine burst bench and Playwright render bench; `scripts/bench.ts` → `bench/results.json` → README table; README with architecture diagram and ADR links.

**Blocked by:** 25, 27

**Status:** claimed

Type: task
Status: claimed
Blocked by: 25, 27

- [ ] Benches labelled synthetic/emulated per ADR 0006
- [ ] Mount/unmount ×20 leak test

**Working rules (every ticket):** `implement` skill; `coding-standards` + `typescript-best-practices` (+ `react-coding-style`, `react-best-practices` for chrome) applied to every line; TDD at the spec's seams; `tsc -b` and the touched test files after each step; one atomic commit per step (`<slice>: <step>`), full suite + `code-review` skill at the end of the ticket; visual tickets end with a **parity gate** (v4 and port side by side on the same live feed, screenshots per stage, user sign-off) and are never delegated to unattended agents. Nothing from `attempt/react-v1`.
