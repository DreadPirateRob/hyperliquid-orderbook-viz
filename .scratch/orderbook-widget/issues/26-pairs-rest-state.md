# 26: Pair picker, REST stats, URL and prefs

**What to build:** Pair popover (`/`, search, Perp/Spot/★, keyboard), top-bar stats every 10 s, coin switch with full reset, URL params and localStorage prefs per ADR 0008, connection dot, pause, gear.

**Blocked by:** 19

**Status:** resolved

Type: task
Status: resolved
Blocked by: 19

- [x] REST adapter parses `meta/spotMeta/metaAndAssetCtxs/allMids` into domain types, skipping malformed spot rows
- [x] URL round-trip test; prefs store test
- [x] E2E: pair switch resets and re-subscribes

**Working rules (every ticket):** `implement` skill; `coding-standards` + `typescript-best-practices` (+ `react-coding-style`, `react-best-practices` for chrome) applied to every line; TDD at the spec's seams; `tsc -b` and the touched test files after each step; one atomic commit per step (`<slice>: <step>`), full suite + `code-review` skill at the end of the ticket; visual tickets end with a **parity gate** (v4 and port side by side on the same live feed, screenshots per stage, user sign-off) and are never delegated to unattended agents. Nothing from `attempt/react-v1`.

## Answer

**REST adapter** — `src/data/hyperliquid-info.ts`: `fetchMarketMeta` (perp `meta` + `spotMeta` in one pass), `fetchUniverse` (drops delisted perps; skips spot rows whose token indexes are absent from `tokens`, rather than emitting a half-built pair), `fetchStats` (mark, 24 h change, volume, funding from `metaAndAssetCtxs`; spot marks come from `allMids` because spot contexts carry no mark). Malformed rows are skipped, never coerced. Tested in `hyperliquid-info.test.ts` against a fake fetch.

**One shared `/info` fetch** — `src/data/info-cache.ts` (`createInfoFetch`): dedupes in-flight identical bodies, per-payload TTL (`meta`/`spotMeta` 600 s, price payloads 9 s so the 10 s stats poll always misses), and on HTTP 429 serves the last good body for a 30 s backoff. The same instance is passed as `fetch` into `createHyperliquidFeed`, the pair list and the stats poll.

**Chrome** — `src/widget/pair-picker.tsx` (`/` opens, search, Perp/Spot/Saved tabs, arrow-key cursor + Enter, lucide `Star` favourites, Escape closes and returns focus to its trigger) and `src/widget/settings.tsx` (cadence, ruler span 4–40, cost notional 10k/100k/1M). Top bar: pair button, mid, grouping segment, view/trails/tape/overlays/metrics toggles, stats, pause (space), connection dot, gear.

**State** — `src/state/prefs.ts` (`createPrefsStore`, Zod-validated, corrupt storage falls back to defaults, `subscribe`) and `src/state/widget-url.ts` (`readUrlState`/`writeUrlState`, defaults written as absent, foreign params preserved) with a fast-check round-trip property.

**Three bugs found and fixed:**

1. `/info` 429 storm — four calls on mount plus a 10 s poll, unshared. Fixed by the caching fetch above.
2. A shared `?g=` link was ignored: the grouping request arrived before the subscription gate existed and was dropped. `applyWantedGrid()` in `src/widget/runtime.ts` now replays it on the `market` event, and `Session.select` stores `wanted` so the feed's `open` handler subscribes at that precision directly.
3. Bid/ask path tags could print a **grouped** price as the best bid/ask. Fixed with `engine.reset({ keepTouch: true })` on a grouping change (aggregation does not move the real BBO, so only a coin change clears it) plus `FrameSample.rawTouch`; `drawTouchPaths` prints no tag at all without it — absent beats precise-looking and wrong.

**Review** — the two reviewer subagents are still rate-limited (429, `retry-after ≈ 4 days`), so the two-axis review was run manually against v4's source and the `coding-standards` / `typescript-best-practices` / `react-*` skills, as on tickets 22–25.

**Gate** — passed on a live feed: `/tmp/icons-bar.png` (top bar, lucide icons, LIVE), `/tmp/icons-picker.png` (pair popover), `/tmp/gear.png` (settings popover), `/tmp/sigma.png` (`Σ` retained on ruler labels at the user's request). Suite green: 130 Vitest, 10 Playwright.
