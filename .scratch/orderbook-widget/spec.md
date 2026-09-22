# Spec: Order Book Observatory

Status: ready-for-agent
Map: [map.md](map.md) · Glossary: [CONTEXT.md](../../CONTEXT.md) · ADRs: [docs/adr](../../docs/adr) · Visual source of truth: `prototype/ladder-prototype-v4.html` on branch `prototype/ladder` (`802ae3c`), per ADR 0009.

## Problem Statement

Order-book widgets show a snapshot: prices and sizes, maybe a depth chart. A trader watching Hyperliquid cannot see *where liquidity came from, how long it has stood, how it is changing, how trades interact with it, how fast it refills, or what executing against it would cost*. The feed makes this hard: `l2Book` is full snapshots at ~5 s (20 levels) and ~0.5 s (5 levels), with no order events, so most "microstructure" tooling either lies about what it can infer or doesn't try.

The first build attempt (branch `attempt/react-v1`) re-derived the visual layer from prose and lost the approved prototype's look and motion. This spec exists so the second build ports the prototype and keeps its feel.

## Solution

A browser-based **market microstructure observatory** for Hyperliquid, deployed on Vercel with a shareable URL: a canvas ladder (classic ladder or centre spine) with per-level trails, a trades tape, a boundary overlay, and metric overlays, driven by a snapshot-native engine over four fused socket streams. Everything the prototype v4 shows and does is reproduced at parity; everything it infers is honest about its producer. React owns the chrome only; data, state and rendering are three plain-TypeScript layers (ADR 0003). Proof is recorded fixtures, property tests, a parity gate against v4, and labelled benchmarks.

## User Stories

### Seeing the book
1. As a trader, I want a price ladder for a Hyperliquid perp or spot pair, so that I can see resting liquidity at each level.
2. As a trader, I want the ladder pinned to a grid with a hysteresis re-centre, so that rows don't jitter as the mid moves by a tick.
3. As a trader, I want the ladder to scroll smoothly (spring-eased) when it re-centres, so that I never lose my place.
4. As a trader, I want each level's bar width and heat cell normalised to the largest level inside the depth ruler, so that small books still read.
5. As a trader, I want a stepped cumulative depth profile behind the bars, so that I can see how depth accumulates from the touch outward.
6. As a trader, I want round-number prices emphasised, so that psychological levels stand out.
7. As a trader, I want a centre-spine view (asks up/right, bids down/left from a central price column), so that I can read symmetric depth at a glance.
8. As a trader, I want to switch between ladder and spine views with a segmented control or the `v` key, so that I can pick the reading that fits.

### Motion and lifecycle
9. As a trader, I want a level that grows to spring to its new width, so that I perceive the change as motion, not a jump.
10. As a trader, I want a level that shrinks or vanishes to leave a fading ghost of its lost width, so that I can see what was pulled.
11. As a trader, I want a newly added level to flash an outline, so that new liquidity is noticed.
12. As a trader, I want a level that was hit by a trade to flash a fill marker and a faint row wash, so that I can tell consumed from cancelled.
13. As a trader, I want long-standing levels to look more saturated than fresh ones (persistence saturation over 20 s), so that stable liquidity reads differently from flicker.
14. As a trader, I want rows outside the depth ruler dimmed, so that the ruler band is where my eye rests.
15. As a trader, I want animation to stop between updates when I choose "on update" cadence, so that a quiet book costs no CPU.
16. As a user who prefers reduced motion, I want springs and pulses to snap, so that the widget honours my OS setting.
17. As a user returning to a background tab, I want the ladder to snap to the current state (no catch-up animation), so that it doesn't replay minutes of motion.

### Trails and boundary
18. As a trader, I want a 12 s trail per level (tiles of size over time) beside the ladder, so that I can see where liquidity has been.
19. As a trader, I want the trails to glide continuously (positioned by time, not sample index), so that they read as a stream, not a slideshow.
20. As a trader, I want bid and ask price paths drawn over the trails with tags at the "now" edge, so that the spread's history is visible.
21. As a trader, I want a 1 px boundary line at the bid/ask gap, so that the touch is unambiguous.
22. As a trader, I want the last trade tagged on the price column at its row, coloured by direction, so that I see where prints land relative to the touch.
23. As a trader, I want a vertical stacked share bar in the label gutter (ask above, bid below, height ∝ bid share), so that top-of-book imbalance is a glance.

### Tape
24. As a trader, I want a trades tape column aggregated per block/price/side with age, direction arrow, price, size and `×n`, so that I can read flow without noise.
25. As a trader, I want outsized prints (≥ P95 of the last ~5 min, min 20 prints) highlighted, so that unusual size is obvious.
26. As a trader, I want new prints to flash in and old ones to fade over a minute, so that recency is visible.
27. As a trader, I want to toggle trails and tape independently (`t`, `p`), so that I can trade horizontal space for information.

### Metric overlays and HUD
28. As a trader, I want a size-delta strip per row (signed, decaying, τ = 3 s) so that I can see net adds/pulls per level without it being called OFI.
29. As a trader, I want a resiliency bar under a level that lost ≥ 50 % of its size, filling toward 80 % of its prior size (amber when capped at 30 s), so that I can see how fast liquidity refills.
30. As a trader, I want a dashed migration connector when a fast-stream level vanishes and an equal-sized one appears within 3 grid ticks, so that I can see orders being repriced.
31. As a trader, I want a book-shape sparkline (cumulative curves both sides with convexity) in the HUD, so that I can judge front-loaded vs flat depth.
32. As a trader, I want a metrics HUD (toggle `m`) with pressure, cancel ratios by count and volume, execution cost at my notional, refill@5 s, convexity, churn, and feed/render telemetry, so that I can read the numbers behind the picture.
33. As a trader, I want to choose the execution-cost notional (10k / 100k / 1M), so that cost reflects my size.
34. As a trader, I want to toggle overlays (`o`) without losing the ladder, so that I can declutter.

### Grouping and pairs
35. As a trader, I want five per-coin grouping options labelled by row step (e.g. `$1 $2 $5 $10 $100` for BTC), so that I can coarsen the book.
36. As a trader, I want `[` and `]` to step grouping, so that I can change it without the mouse.
37. As a trader, I want a grouping change to reset the ladder cleanly (freeze → dim → crossfade) under a `RESYNCING` state, so that stale rows never mix with the new grid.
38. As a trader, I want a pair picker (`/`) with search, Perp/Spot/★ tabs, keyboard navigation, and favourites, so that I can switch markets fast.
39. As a trader, I want mark, 24 h change, 24 h volume and funding in the top bar, refreshed every 10 s, so that the ladder has context.
40. As a trader, I want spot pairs to display as `BASE/QUOTE` with the base token's size decimals, so that spot books format correctly.

### Sharing, prefs, state
41. As a user, I want `coin`, `view`, `trails`, `tape`, `ovl`, `g` in the URL, so that I can share exactly what I see.
42. As a user, I want cadence, ruler distance, notional, metrics-on and favourites remembered in localStorage, so that my setup persists.
43. As a user, I want the connection state (CONNECTING → SUBSCRIBING → LIVE → STALE → RESYNCING → DISCONNECTED) as a dot and word, so that I know whether the picture is current.
44. As a user, I want to pause (space) rendering while the feed keeps flowing, so that I can study a moment.
45. As a user embedding the widget, I want `<OrderBook coin view … feed>` props to seed the initial state and `onStateChange` to report changes, so that I can compose it into a page.
46. As a user embedding the widget, I want to inject a fixture reader as the feed, so that I can demo or test it offline.

### Accessibility and devices
47. As a keyboard user, I want every control reachable and the popovers to trap and return focus, so that I can operate the widget without a mouse.
48. As a screen-reader user, I want a text alternative for the canvas and a polite live region announcing mid and connection at most once a second, so that I get the essentials.
49. As a mobile user, I want the layout to collapse (tape → trails → overlays) and switch to the spine construction below 600 px, so that the book is readable on a phone.
50. As a mobile user, I want a bottom sheet for controls below 900 px, so that the top bar stays legible.
51. As a mobile user, I want pinch to change grouping, so that I can coarsen without controls.

### Trust and proof
52. As a reviewer, I want every metric to name its real producer in the feed, so that nothing claims more than the data supports.
53. As a reviewer, I want engine behaviour proven by replaying recorded sessions with per-step invariants, so that correctness isn't asserted by hand.
54. As a reviewer, I want burst benchmarks (1k–100k events/s) clearly labelled synthetic and framed as headroom over the ~30 events/s feed, so that numbers aren't misread.
55. As a reviewer, I want a render benchmark at desktop and phone viewports with p50/p95 frame times, so that "60 fps" is measured.
56. As a reviewer, I want the port verified against prototype v4 side by side, so that the feel is demonstrated, not described.
57. As a reviewer, I want ADRs and a README architecture diagram linked from the deployed page, so that the reasoning is one click away.

## Implementation Decisions

### Layers (ADR 0003)
- **Data layer**: feed adapter (socket, ping every 50 s, bounded backoff, four subscriptions, per-stream ack gate, on-grid check, serialised precision changes, historical-trades flag, REST universe + 10 s stats) and engine (typed-array book per side, window-authority fusion, one-pass diff → lifecycle events, price-keyed history ring, live trade ring, metrics). Pull API `apply/snapshot/drain/metrics/reset`; time only via events. Structured-clone-safe types.
- **State layer**: widget state reducer + URL (`replaceState`, widget params only, foreign params preserved), prefs external store, and the **sampler** ported from v4's `sample(dt)`: per-price animation map `hist` (spring, pulses, trail, field, resiliency watch), anchor spring, row layout, ruler, cumulative, share/micro, tape aggregation, P95 threshold, migration list. Output: one **frame sample** per tick (v4's `S`: rows with `px, side, shown, live, cum, inRuler, F`, `maxSz, maxCum, maxF, ribY, rulerY, midIdx, dec, rawDec, mid, micro, share, bb, aa, M`).
- **Rendering layer**: stateless draw over the sample, ported from v4 — `drawLadder`, `drawSpine`, `drawTape`, `ribbon1`, `shareBar`, `trailStrip`, `heatColour`, `pulseState`, `persistence`, `drawShapePanel` — plus React chrome. Two canvases (static/dynamic), DPR-scaled with explicit CSS size, `desynchronized`.

### Port doctrine (ADR 0009)
- v4 fixes **behaviour and constants**: palette `bg #0b0e11, text #e5e7eb, dim #6b7280, bid rgb(45,212,191), ask rgb(251,113,133), hot rgb(251,191,36), mid rgb(96,165,250)`; `ROW 22`, `BAR 44`, `TAPE_W 200`, block 300 px + 170 px gutter in trails mode; springs `Spring(k=180,c=24)` for size, `Spring(k=40,c=13)` for anchor with re-centre when `|mid − target| > gridTick·half·0.3`; pulse decays `fill 500, ghost 700, add 450, grew 400` ms, pulses pruned at 1.5 s, ≤ 6 per level; `persistence = min(1, age/20000)`; heat `sat = 0.35 + 0.65·persistence`, `rel = shown/maxSz`, hot when `rel > 0.85` (blend to hot colour), alpha `(0.15 + 0.85·rel^0.7)·sat`; block alpha `0.22 + 0.5·persistence`; ruler dim `0.45`; trail `TRAIL_MS 12000, TRAIL_DT 250`, tile alpha `(0.06 + 0.42·rel^0.7)·(0.35 + 0.65·persistence)`, tiles clamped to the column, fill dots at trade times; path stroke 4 px @ 0.22 under 1.25 px @ 0.95; hist prune when size 0 and unchanged 60 s with no pulses/watch; tape `TAPE_CAP 50`, row 18 px, fade `max(0.35, 1 − age/60 s)`, enter `decay(age, 350)`, P95 over 5 min with ≥ 20 prints; migration pairing on fast only, `|Δsize| ≤ 10 %`, `|Δpx| ≤ 3 gridTick`, shown 600 ms decay, pruned 1.5 s; field `TAU_F 3000`; resiliency `RES_TRIG 0.5, RES_TARGET 0.8, RES_CAP 30000`, watch cleared after cap + 5 s; deferred attribution `GRACE 600` ms with `recent` trades kept 15 s; cancel ratio window 60 s; `loop()` cadence: 30 fps cap `1000/30 − 1`, on-update skips when version unchanged and nothing moves.
- Code shape follows the coding-standards skill: integer raw ticks (ADR 0002) parsed exactly at the adapter; errors as tagged values at the adapter and parser; typed arrays and pre-allocated stores replace per-frame objects; domain modules for pure calculations (tick maths, grouping derivation, metrics formulas); imperative shell = runtime (loop, resize, visibility, feed lifetimes); JSDoc on exports; no `any`, no `!`.
- Behaviour wins over standards on conflict; each deviation is appended to ADR 0009.
- Nothing is copied from `attempt/react-v1`.

### Feed (ADR 0007, Feed Cadence Strategy, Feed Facts)
- `wss://api.hyperliquid.xyz/ws`; subscriptions `l2Book{coin,nSigFigs?,mantissa?}` slow and `{…, fast:true}`, `bbo{coin}`, `trades{coin}`; `data.fast === true` discriminates; `levels[0]` bids desc / `[1]` asks asc asserted, violations dropped and counted; first `trades` after subscribe flagged historical; mantissa 1 never sent.
- Precision change: unsubscribe both books → ladder reset → subscribe both; per-stream ack gate; on-grid check rejects finer in-flight pushes; a change during a pending change is queued.
- Grouping options: `CANDIDATES = [{N:5},{N:5,m:2},{N:5,m:5},{N:4},{N:3}]`, `tick = max(rawTick, m·10^(⌊log10 mid⌋ − N + 1))`, deduped by tick, labelled by step; derived from the REST mark on coin select and re-derived when the mid's decade changes (v4 behaviour).
- REST `POST /info`: `meta` + `spotMeta` (perps filtered `!isDelisted`, spot rows with dangling token indexes skipped), `metaAndAssetCtxs` + `allMids` every 10 s.

### Engine (ADR 0001, 0002, Engine Architecture, Precision Change Semantics)
- Prices: branded integer `Tick`; `rawTick = 10^-(D − szDecimals)`, D = 6 perp / 8 spot.
- Fusion by window authority; BBO owns the touch (levels beyond the new best are dropped); BBO-stream decreases excluded from side aggregates.
- Lifecycle events `added|grew|shrank|vanished|outOfWindow|migrated` with stream tag, `consumed/cancelled` split (temporal trade join over `[prevPushTime, t]`, re-attributed within 600 ms), `confidence: heuristic`.
- Connection: `LIVE` on first accepted push; `STALE` when fast > 3 s or slow > 20 s; `RESYNCING` on precision/coin change until the first post-ack push.
- Metrics (Derived Metrics Definitions as amended by Metric Overlays Prototype): cumulative depth; persistence; churn W = 5 s; TOB share/imbalance/micro + imb5; size-delta field + pressure; cancel ratio by count (headline) and volume over 60 s; resiliency median refill time + refill@5 s; execution cost by notional (VWAP, bps, fill fraction, levels, exceeds); convexity on the visible window; book shape curves. Lazy on book version.

### State and chrome (ADR 0008)
- Runtime object with `update(state)`; React effect on state; diffs coin/grouping/pause. Frame loop reads the runtime's copy.
- Prefs singleton store; `useSyncExternalStore`. URL `replaceState` only. Props seed only. HUD, top-bar mid, connection dot written by ref at 2 Hz. Live region ≤ 1 Hz.
- Chrome = exactly v4's DOM: top bar (pair button with badge, mid, mark/24h/vol/funding, grouping segment, view segment, trails/tape/metrics/overlays toggles, connection, pause, gear), pair popover (search, tabs, ★, list with price/24h), gear popover (cadence, ruler 4–40, notional), HUD `<pre>` + shape canvas. Icons: lucide-react. No tooltip; pointer feeds a hover-row highlight painted on the dynamic canvas.
- Keyboard: `/` pair, `v` view, `t` trails, `p` tape, `m` metrics, `o` overlays, space pause, `[ ]` grouping, Esc close.
- Responsive: breakpoints 1280 / 900 / 600; collapse tape → trails → overlays; spine below 600; bottom sheet below 900; touch: pinch-to-group, tap-hold hover.

### Fixture replay (Proof Surface Design)
- Fixture reader implements the same feed-source contract as the socket adapter: replays `{rx, ch, data}` lines at 1×/N×/as-fast-as-possible with seek; control lines drive resubscribe/disconnect/reconnect; recorded timestamps are rebased onto the wall clock so staleness and windows behave as live; only recorded precisions can be honoured (others acknowledged without grid change); `.gz` served with `Content-Encoding` is detected by magic bytes.
- Demo page: `?fixture=<name>` swaps the live feed for the reader.

## Testing Decisions

Good tests assert observable behaviour through real seams — returned values, produced samples, DOM/canvas outcomes — never spies, module mocks, or implementation wiring. Four seams, highest first (confirmed with the user):

1. **Widget entrypoint with injected fixture feed** (Playwright, E2E): `<OrderBook feed={reader}>` on a recording → connection reaches LIVE, mid and grouping labels populate, keyboard map and URL sync behave, canvas paints non-background pixels at known rows, mount/unmount ×20 leaks no sockets/listeners/rAF/timers. Both viewports (1500×820 DPR 1, 390×844 DPR 3 emulated).
2. **Fixture → engine** (Vitest + fast-check, Node): replay every recording asserting per-step invariants (sorted sides, non-negative sizes, cum monotone, version bumps ≤ 1 per event, consumed + cancelled = decrease); property tests (diff reconstructs the book; fusion order-independent for equal-time pushes; px string ↔ tick round-trip); scenario tests on broken copies (duplicate, non-monotonic, garbage line, off-grid, drop + reconnect, precision swap with in-flight pushes, grid change at fixed precision).
3. **Facts → frame sample** (Vitest, Node, fake clock): sampler over synthetic facts asserting v4's numbers — spring settle time, pulse decay values at known ages, anchor re-centre only beyond the band, animation state following its price level across re-centres, trail scroll fraction, tape aggregation/P95, ruler normalisation. Synthetic inputs labelled synthetic.
4. **Sample → pixels**: no pixel snapshots. The **parity gate** (v4 and port side by side on the same live feed, screenshots per stage, user sign-off) plus the render benchmark are the proof.

Benchmarks (ADR 0006): `vitest bench` engine burst 1k/10k/50k/100k events/s × 10 s (synthetic, pre-validated), reporting sustained rate, apply p50/p99, heap delta; Playwright render bench replaying the active BTC recording 60 s per cadence × trails/tape on/off × two viewports; `scripts/bench.ts` → `bench/results.json` → README table between markers. Prior art: none in repo; fixtures in `fixtures/`.

## Out of Scope

- Multi-venue books; depth chart; light theme; per-order OFI; delta/sequence synchronisation; full canvas accessibility beyond text alternative + live region (map Out of scope).
- Flow histograms, Worker/OffscreenCanvas migration, replay scrubber, quick-grouping drag gesture (map fog; revisit after the port lands).
- Tooltip (removed with the user; hover row only).
- Reusing any code from `attempt/react-v1`.

## Further Notes

- Prototype v4 uses floats and per-frame objects; the port keeps its numbers and shape of computation, not its allocation pattern.
- v4 constants are the contract; if a later decision changes one (e.g. palette), the change goes through an ADR amendment, never a silent edit.
- The tapesurf research remains inspiration for layout; its literal palette is on the do-not-copy list.
