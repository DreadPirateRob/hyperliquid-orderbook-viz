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
  - Feeds: slow + fast `l2Book`, `trades`, `bbo`, one socket (see Feed Cadence Strategy).
  - Prices: integer ticks internally, formatted at the edge.
  - Ladder: pinned grid, hysteresis re-centre.
  - Animation: springs behind one `animate(target)` primitive; event pulses decay; render cadence user-capped (60 / 30 / on-update) and `prefers-reduced-motion` honoured; feed ingest never throttled.
  - Stack: React + TypeScript + Vite; Canvas 2D, layered canvases, GPU-friendly (no per-frame readbacks, cached gradients/glows, `desynchronized` hint); engine in plain TS outside React; Worker/OffscreenCanvas only if benchmarks justify it (ADR).
  - Widget: `<OrderBook coin nSigFigs …/>` includes its own controls (coin selector, nSigFigs dropdown, HUD toggle, render cadence, depth-ruler distance, execution-cost notional); demo page is a shell. Vercel.
  - Visuals in: heat cell, depth profile, depth ruler, ribbon (mid + share bar + last), round-number emphasis, persistence saturation, order-count glyph, fill markers, size-delta field overlay, resiliency overlay, migration trails, book-shape sparkline, event waterfall (= pulses).
  - Metrics in: cumulative depth, persistence, churn, imbalance, microprice, trade–level interaction (consumed vs cancelled), resiliency, execution cost, size-delta field.
  - Proof: recorded JSONL fixtures, engine property/invariant tests, synthetic burst benchmarks (1k/10k/50k/100k events/s, labelled synthetic), frame instrumentation in HUD + scripted render benchmark, malformed/out-of-order/stale scenarios; numbers published by script, not typed.
  - UX: hover inspection, pause/replay, keyboard/ARIA dropdowns, throttled live-region for best prices, dark theme only.
  - Connection states: DISCONNECTED → CONNECTING → SUBSCRIBING → LIVE → STALE → RESYNCING, shown in HUD.

## Decisions so far

- [Hyperliquid Feed Facts](issues/01-hyperliquid-feed-facts.md): `l2Book` is a full snapshot; 20 levels/side at ~5.4 s observed cadence, `fast` gives 5 levels at ~0.54 s. Tick derivation formula + worked examples in `docs/research/hyperliquid-feed.md`. Precision change = unsubscribe old object, subscribe new; two precisions on one socket are indistinguishable. `levels[0]` bids desc / `[1]` asks asc is observed, not contracted: assert it. Ping every ~50 s or the server drops at 60 s. Trade↔book causal ordering is not guaranteed: consumed-vs-cancelled stays a heuristic.
- [Tapesurf Visual Catalogue](issues/02-tapesurf-visual-catalogue.md): ladder is WebGL2 canvas (controls DOM); row = grouped price → heat cell → exact size → order block, plus stepped cumulative profile; heat brightness and block width normalise to the largest level *inside* the depth rulers; centre divider is last trade, not BBO; Max FPS 30/60/Unlimited decoupled from capture. Findings + 18 captures in `docs/research/tapesurf-orderbook.md`. Do-not-copy list: literal palette, last-trade-as-best-line, hidden drag grouping.
- [Feed Cadence Strategy](issues/16-feed-cadence-strategy.md): four subscriptions on one socket (slow 20-level ~5 s, fast 5-level ~0.5 s, bbo ~70 ms, trades); fast messages are discriminable by `data.fast`. Fusion by window authority (newest stream wins in its price window); lifecycle events on every merged change, tagged by stream; STALE thresholds fast > 3 s / slow > 20 s; precision change resubscribes both books, ladder resets on first fast push; fixtures are one interleaved JSONL.
- [Engine Architecture](issues/03-engine-architecture.md): prices as integer `rawTick` counts per coin (grid/`sigTick` is presentation); sorted typed arrays per side, merge pass = diff; price-keyed history ring with bounded post-vanish retention; lifecycle events `added|grew|shrank|vanished|outOfWindow`, every decrease split into `consumed`/`cancelled` by temporal trade join (live evidence: 17% of top-5 decreases trade-explained), `historical` first trades batch excluded; pure pull API `apply/snapshot/drain/metrics` with time only via events (`tick(now)` from host); socket adapter owns transport, engine owns `LIVE|STALE|RESYNCING`; all I/O types structured-clone-safe for a deferred Worker.
- [Precision Change Semantics](issues/04-precision-change-semantics.md): server-side aggregation via resubscribe of both books; control superseded by the prototype: five per-coin derived ticks labelled by row step, no `full`; persistence is fresh start (raw-tick keys, no merging); transition is freeze-and-crossfade under `RESYNCING(precision)`, top 5 animate in on first fast push; a grid-tick change at fixed precision (price crossing a power of ten) takes the same path without RESYNCING and gets a fixture + test.
- [Ladder Visual And Motion Prototype](issues/05-ladder-visual-and-motion-prototype.md): classic ladder default + centre spine view; trails (12 s per-row history) and trades tape (aggregated per block/price/side, P95 outliers) as 200 px toggle columns; ribbon = own 36 px row with share bar (divider = bid share = µ position) reading BBO at raw precision, never the grouped book; asks accumulate upward from best ask; springs k180/c24 (size) and k40/c13 (anchor, 30 % hysteresis); pulse τ 400–700 ms; persistence saturation over 20 s; grouping = five per-coin derived ticks labelled by row step, segmented control, change = full ladder reset + per-stream ack gate + on-grid check + serialised resubscribes; top bar = pair popover (search, perp/spot/★), mid + REST stats, grouping, view/trails/tape/metrics toggles, connection dot, pause, gear; URL for shareable state, localStorage for prefs; spot markets in scope. Full value list on the ticket; branch `prototype/ladder` @ `894baab`.

## Not yet specified

- **Flow histograms** (1h/4h/1d buy vs sell): needs minutes of accumulated trades and a time axis; revisit once the trades pipeline exists.
- **Worker / OffscreenCanvas migration**: only if the render benchmark shows main-thread contention; the renderer interface must make it a transport change.
- **Metric overlays not yet prototyped**: size-delta field, resiliency overlay, migration trails, book-shape sparkline were in the prototype's brief but not built; they depend on Derived Metrics Definitions and get a second, smaller prototype after it.
- **Remaining UX detail**: hover tooltip contents, replay scrubber (pause exists; replay needs fixtures), execution-cost readout placement in the ribbon (after Derived Metrics).
- **Grid change at fixed precision (price crossing a power of ten)**: prototype re-derives the options and flashes the segment, but does not resubscribe; whether the server's grid shifts under a fixed `nSigFigs` subscription needs a fixture to confirm the transition path from Precision Change Semantics.
- **Implementation slicing**: the implementation slice will be too large for one session; it splits into sub-tickets once types/contracts exist.
- **Quick-grouping gesture**: local client-side coarsening (drag on the ladder) layered over the server precision; only after the prototype shows the dropdown alone is not enough.

## Out of scope

- Multi-venue / cross-exchange alignment: Hyperliquid only.
- Depth chart (area chart of cumulative depth): the depth profile behind the ladder covers it.
- Light theme: the palette encodes information; a second palette doubles tuning without adding signal.
- True order-flow imbalance (per-order OFI): the feed carries no order events; the size-delta field is the honest substitute.
- Full canvas accessibility beyond a text alternative and live-region.
- Delta-stream / sequence-number book synchronisation: no producer in this feed.
