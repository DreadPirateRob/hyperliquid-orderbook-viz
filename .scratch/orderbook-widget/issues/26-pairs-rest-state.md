# 26: Pair picker, REST stats, URL and prefs

**What to build:** Pair popover (`/`, search, Perp/Spot/★, keyboard), top-bar stats every 10 s, coin switch with full reset, URL params and localStorage prefs per ADR 0008, connection dot, pause, gear.

**Blocked by:** 19

**Status:** ready-for-agent

Type: task
Status: open
Blocked by: 19

- [ ] REST adapter parses `meta/spotMeta/metaAndAssetCtxs/allMids` into domain types, skipping malformed spot rows
- [ ] URL round-trip test; prefs store test
- [ ] E2E: pair switch resets and re-subscribes

**Working rules (every ticket):** `implement` skill; `coding-standards` + `typescript-best-practices` (+ `react-coding-style`, `react-best-practices` for chrome) applied to every line; TDD at the spec's seams; `tsc -b` and the touched test files after each step; one atomic commit per step (`<slice>: <step>`), full suite + `code-review` skill at the end of the ticket; visual tickets end with a **parity gate** (v4 and port side by side on the same live feed, screenshots per stage, user sign-off) and are never delegated to unattended agents. Nothing from `attempt/react-v1`.
