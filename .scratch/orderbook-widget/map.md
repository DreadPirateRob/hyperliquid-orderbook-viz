# Map: Order Book Observatory

Label: wayfinder:map
Tracker: local markdown (`.scratch/orderbook-widget/issues/NN-<slug>.md`)

## Destination

A reviewed, deployed order-book widget for Hyperliquid with a shareable demo URL, reached through ordered slices: decisions → ADRs → spec → types/contracts → implementation → review → deploy + published benchmarks.

## Notes

- **Execution override**: this map carries execution. Slices after the decision tickets are `task` tickets that build the thing; the map is done when the demo is deployed and reviewed.
- **North star** (user's words): *Don't build an order-book component; build a browser-based market microstructure observatory.* Answer: where liquidity is → where it came from → how persistent it is → how it is changing → how trades interact with it → how quickly it recovers → what executing against it would cost.
- **Standing preference**: default to the most senior engineering approach; drop it only when the overhead is demonstrably unjustified, and decide that together, never silently.
- **Honesty rule**: the feed is full snapshots (`l2Book`), not deltas: observed ~5.4 s median between 20-level pushes, ~0.54 s with `fast: true` (5 levels). Every "senior" mechanism must have a real producer in this feed or be labelled synthetic. No sequence numbers, no gap counts, no per-order OFI. ADRs say why.
- **Inspiration**: tapesurf.com order-book view (screenshots in the charting session: heat cells, depth profile, depth ruler, cumulative labels, best line, spread row, flow histograms). Feel + layout + motion all wanted.
- **Skills every session consults**: `grilling` + `domain-modeling` for decision tickets; `prototype` for visual/animation tickets; `research` for AFK fact-finding. Glossary lives in `CONTEXT.md`; challenge new terms against it.
- **Locked in charting** (not ticketed, already decided):
  - Feeds: `l2Book` + `trades` + `bbo`, one socket.
  - Prices: integer ticks internally, formatted at the edge.
  - Ladder: pinned grid, hysteresis re-centre.
  - Animation: springs behind one `animate(target)` primitive; event pulses decay; render cadence user-capped (60 / 30 / on-update) and `prefers-reduced-motion` honoured; feed ingest never throttled.
  - Stack: React + TypeScript + Vite; Canvas 2D, layered canvases, GPU-friendly (no per-frame readbacks, cached gradients/glows, `desynchronized` hint); engine in plain TS outside React; Worker/OffscreenCanvas only if benchmarks justify it (ADR).
  - Widget: `<OrderBook coin nSigFigs …/>` includes its own controls (coin selector, nSigFigs dropdown, HUD toggle, render cadence, depth-ruler distance, execution-cost notional); demo page is a shell. Vercel.
  - Visuals in: heat cell, depth profile, depth ruler, best/mid line, microprice ribbon (spread row), round-number emphasis, persistence saturation, order-count glyph, fill markers, size-delta field overlay, resiliency overlay, migration trails, book-shape sparkline, event waterfall (= pulses).
  - Metrics in: cumulative depth, persistence, churn, imbalance, microprice, trade–level interaction (consumed vs cancelled), resiliency, execution cost, size-delta field.
  - Proof: recorded JSONL fixtures, engine property/invariant tests, synthetic burst benchmarks (1k/10k/50k/100k events/s, labelled synthetic), frame instrumentation in HUD + scripted render benchmark, malformed/out-of-order/stale scenarios; numbers published by script, not typed.
  - UX: hover inspection, pause/replay, keyboard/ARIA dropdowns, throttled live-region for best prices, dark theme only.
  - Connection states: DISCONNECTED → CONNECTING → SUBSCRIBING → LIVE → STALE → RESYNCING, shown in HUD.

## Decisions so far

- [Hyperliquid Feed Facts](issues/01-hyperliquid-feed-facts.md): `l2Book` is a full snapshot; 20 levels/side at ~5.4 s observed cadence, `fast` gives 5 levels at ~0.54 s. Tick derivation formula + worked examples in `docs/research/hyperliquid-feed.md`. Precision change = unsubscribe old object, subscribe new; two precisions on one socket are indistinguishable. `levels[0]` bids desc / `[1]` asks asc is observed, not contracted: assert it. Ping every ~50 s or the server drops at 60 s. Trade↔book causal ordering is not guaranteed: consumed-vs-cancelled stays a heuristic.
- [Tapesurf Visual Catalogue](issues/02-tapesurf-visual-catalogue.md): ladder is WebGL2 canvas (controls DOM); row = grouped price → heat cell → exact size → order block, plus stepped cumulative profile; heat brightness and block width normalise to the largest level *inside* the depth rulers; centre divider is last trade, not BBO; Max FPS 30/60/Unlimited decoupled from capture. Findings + 18 captures in `docs/research/tapesurf-orderbook.md`. Do-not-copy list: literal palette, last-trade-as-best-line, hidden drag grouping.

## Not yet specified

- **Flow histograms** (1h/4h/1d buy vs sell): needs minutes of accumulated trades and a time axis; revisit once the trades pipeline exists.
- **Worker / OffscreenCanvas migration**: only if the render benchmark shows main-thread contention; the renderer interface must make it a transport change.
- **Coin universe**: how the coin selector learns available coins (`meta` / `spotMeta`), and whether spot markets are supported at all.
- **UX detail after the prototype**: HUD layout, hover tooltip contents, pause/replay scrubber, execution-cost input placement. Sharpens once the ladder prototype settles the visual language.
- **Implementation slicing**: the implementation slice will be too large for one session; it splits into sub-tickets once types/contracts exist.

## Out of scope

- Multi-venue / cross-exchange alignment: Hyperliquid only.
- Depth chart (area chart of cumulative depth): the depth profile behind the ladder covers it.
- Light theme: the palette encodes information; a second palette doubles tuning without adding signal.
- True order-flow imbalance (per-order OFI): the feed carries no order events; the size-delta field is the honest substitute.
- Full canvas accessibility beyond a text alternative and live-region.
- Delta-stream / sequence-number book synchronisation: no producer in this feed.
