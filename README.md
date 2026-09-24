# Order Book Observatory

A live Hyperliquid order-book widget. It shows not just where depth is, but what is happening to it: what was added, what was pulled, what was eaten, and how fast a level comes back.

The venue sends snapshots, not order events. Everything derived from them is either an exact consequence of those snapshots or an honestly labelled heuristic — and the widget says which.

![The ladder on the live BTC feed](docs/images/ladder.png)

```
npm install
npm run dev                                                # live socket
npm run dev -- --open '/?fixture=btc-perp-active&speed=1'  # replay a recording
npm run check                                              # typecheck, lint, 150 unit tests
npm run e2e                                                # 17 Playwright tests
```

---

## Feature guide

### The top bar

![Top bar](docs/images/bar.png)

Left to right: the pair button (`/`), the mid, the grouping the server confirmed, the grouping segment (`[` and `]`), the view and column toggles, 24 h stats, pause (space), the connection dot, and settings.

**Pause freezes the picture, not the feed.** The engine keeps folding every push while paused — only sampling and painting stop, so the canvas holds the frame it had and the loop does no work at all. Resuming shows the book as it is _now_; the paused interval is never replayed as animation. The connection dot stays live while paused, so a drop is still visible.

The connection dot is not decoration: `LIVE`, `STALE` (no push inside the stream's expected interval), `RESYNCING` (a grouping change is in flight) and `DISCONNECTED` are distinct states, and the ladder behaves differently in each.

### The ladder

Each row is one price on the grouping grid, and carries, from the centre outwards: the price label (round grid multiples are brighter), a heat cell whose colour saturates with relative size, the size bar, and the size itself. Round numbers are emphasised because that is where resting liquidity clusters.

Rows outside the depth ruler are dimmed rather than hidden, so the shape of the book beyond the ruler is still legible. `Σ` labels mark the ruler's cumulative depth at each stop.

### Motion and pulses

A level that changes does not simply redraw. It pulses by _kind_: an outline for an add, a colour lift for a grow, a ghost bar showing exactly what was lost on a shrink, and a fade on vanish. Rows spring to their new y rather than jumping, so a ladder that shifts by one tick reads as motion, not as a new screen. `prefers-reduced-motion` turns the springs off.

### Trails and the touch paths

![Trail column](docs/images/trails.png)

The left column is sixty seconds of history for every visible level: one tile per sample, coloured by that level's size at the time. A level that has been sitting there for ten seconds looks nothing like one that appeared 400 ms ago.

Changing the grouping does not erase it. Coarsening merges the finer history into the new rows exactly; going finer keeps the coarser history as a block spanning the band of prices it covered, because nothing ever recorded how the depth was spread inside that bucket. For a minute after a change the column shows the old grouping on the left and the new one on the right.

Drawn over it are the bid and ask touch paths — where the best bid and best ask have actually been — with a white dot at each print and a price tag at the right edge. The tag prints only when the real BBO is known: after a grouping change the engine keeps the true touch rather than showing an aggregated price that would look precise and be wrong.

### Metric overlays

![Metric overlays around the touch](docs/images/overlays.png)

Toggled with `o`. In the shot above, reading left to right on each row: the price label, the heat cell, then the narrow overlay strip before the size bar.

- **Size-delta field** — the narrow strip per row, whose colour and height encode the decayed sum of size changes at that price (τ = 3 s). Teal means net adds, rose means net pulls. It is deliberately _not_ called order-flow imbalance: the feed carries no order events (ADR 0005).
- **Resiliency bars** — the thin light line under a size bar, on a level that lost at least half its size; it fills as the level refills.
- **Migration connectors** — a dashed line with a dot when a level vanished at one price and an equal-sized one appeared within three ticks in the same push. That pairing is a heuristic, not a fact.

The dimmed band (here on 86622) is the hover highlight, painted on the canvas itself because there are no DOM rows to style. The tagged row is the touch, and `Σ` marks a ruler stop's cumulative depth.

### The trades tape

![Tape](docs/images/tape.png)

Prints, newest first, aligned with the row they hit: age, direction mark, price, size, and an `x n` badge when consecutive prints at one price are folded. Sizes above the tape's 95th percentile are highlighted, so a real sweep stands out from noise.

### The spine

![Spine view](docs/images/spine.png)

`v` switches to a centre-out reading: prices down the middle, size growing outward, mirrored cumulative depth profiles behind. It is the same book with the trails and tape columns reclaimed, and it is what narrow hosts get automatically.

### The metrics HUD

![Metrics HUD](docs/images/hud.png)

`m` opens the HUD: pressure, cancel ratios by count and by volume, churn, median refill and refill-at-5 s, convexity, and render telemetry. It is written straight to the DOM by ref at 2 Hz — React does not re-render for it, and an end-to-end test asserts exactly that.

Every row explains itself on hover, and every control in the bar and the settings panel carries the same kind of tooltip. The text lives beside the formatting in `src/widget/hud.ts`, so a metric cannot ship without one — a unit test and an end-to-end test both fail if a row has no explanation.

#### How to read each row

| Row        | What it is                                                                                                | How to read it                                                                                                                                                             |
| ---------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MARKET`   | Coin, grouping step, socket state.                                                                        | `LIVE` is a current book. `RESYNCING` means a grouping or precision change is in flight and the ladder is deliberately frozen rather than mixing two grids.                |
| `BOOK`     | Levels held per side, share of resting size inside the visible window, 5-level imbalance.                 | `imb5` runs −1 (all size on the ask) to +1 (all on the bid); near 0 is balanced. A low `share` means most depth is outside the window you are looking at.                  |
| `PRESSURE` | Exponentially weighted size-delta field, 3 s half-life: size joining adds, size leaving subtracts.        | Positive means size is arriving faster on the bid, negative on the ask. It is in grouped size units — read it against this market's typical row size, not as a percentage. |
| `CANCEL%`  | Of the size that left each side, how much was cancelled rather than traded, by event count and by volume. | High by count but low by volume is many small pulls; the reverse is a few large ones. A dash means too few decreases in the window to say.                                 |
| `CHURN/s`  | Level changes per second and size churned per second, counting every change rather than only decreases.   | High churn with low cancel% is genuine turnover; high churn with high cancel% is quoting noise.                                                                            |
| `REFILL`   | Median time for a consumed level to come back, and the share refilled within 5 s.                         | A quick median with a high `@5s` share is a resilient book. `>30s` means most levels never came back inside the window.                                                    |
| `CONVEX`   | Share of each side's visible depth sitting nearest the touch.                                             | Above 0.5 the book is front-loaded and thin behind it; below 0.5 depth is spread out and the touch is cheaper to move.                                                     |
| `RENDER`   | Frame rate and per-frame cost over the last 120 frames.                                                   | A p95 well under 16.7 ms leaves headroom at 60 fps; a p95 near it means frames are at risk of being dropped.                                                               |

### Pair picker

![Pair picker](docs/images/pair-picker.png)

`/` opens it: search, Perp / Spot / Saved tabs, arrow keys and Enter, favourites. Switching coin resets the engine and resubscribes.

Rows are ranked, not left in venue order: an exact ticker match first, then prefix matches, then by 24 h notional volume — the only liquidity proxy the stats endpoint offers — with an alphabetical tiebreak. Typing `eth` puts ETH above ETHFI regardless of size. Prices and 24 h changes come from one shared, deduplicating `/info` fetch.

### Settings

![Settings](docs/images/settings.png)

Render cadence (60 fps, 30 fps, or draw only on update) and how far the depth ruler reaches. These are preferences: they persist in `localStorage` and stay out of the URL, while everything shareable (coin, grouping, columns, view) lives in the URL (ADR 0008).

Below them, the demo hands the widget its recordings: one click swaps the live socket for any fixture, and while a recording is playing a speed control retimes it. Speed applies to the playback in flight — the recording does not restart, and the schedule re-anchors where it has actually reached rather than retiming from the beginning and jumping. Recordings and speed are shareable state, so they land in the URL as `?fixture=` and `?speed=`.

The recordings are the host's, not the widget's: `OrderBook` takes an optional `replay` prop, and an embedder that passes nothing gets no replay section. The library knows about a `FeedSource`, never about a fixture directory.

### Grouping

The segment asks the venue for a different aggregation. The widget freezes and dims the old ladder while the change is in flight rather than mixing rows from two grids, and the dot reads `RESYNCING` until the new grid is confirmed. A shared link carrying `?g=` subscribes at that grouping directly.

### Responsive, touch, accessibility

![Bottom sheet at tablet width](docs/images/sheet.png) ![Phone layout](docs/images/phone.png)

Columns leave in order of what they cost against what they add: tape below 1280 px, trails below 900 px, overlays below 600 px, where the spine takes over. Popovers become bottom sheets below 900 px. Pinch changes grouping where there is no keyboard. The canvas carries a text alternative, and a polite live region announces mid and connection at no more than 1 Hz.

---

## Architecture

Three layers, one direction: rendering reads state, state reads data, nothing pushes back (ADR 0003).

```mermaid
flowchart TD
  WS[Hyperliquid socket<br/>l2Book slow + fast, bbo, trades] --> Wire[wire.ts<br/>parse, validate, tag stream]
  REST[Hyperliquid /info<br/>meta, contexts, mids] --> Info[info-cache.ts<br/>dedupe, TTL, 429 backoff]
  Wire --> Feed[hyperliquid-feed.ts<br/>subscription gate, reconnect]
  Info --> Feed
  Feed --> Engine[engine.ts<br/>fused book, level events,<br/>attribution, metrics]
  Engine --> Sampler[sampler.ts<br/>rows, springs, pulses, trails]
  Sampler --> Draw[ladder.ts / spine.ts / tape.ts<br/>canvas painters]
  Engine --> Runtime[runtime.ts<br/>frame loop, cadence, status]
  Sampler --> Runtime
  Runtime --> Draw
  Runtime --> Chrome[order-book.tsx<br/>React chrome, written by ref]
  Fixture[fixtures/*.jsonl.gz<br/>recordings] -.-> Feed
```

- **Data** (`src/data`) — wire parsing, the subscription gate, the snapshot-native engine, attribution, metrics.
- **State** (`src/state`) — per-frame sampling, springs, trails, tape, preferences, URL state.
- **Rendering** (`src/render`) — stateless painters over a `DrawContext`.
- **Chrome** (`src/widget`) — the React shell, which never re-renders for a frame.

## Decisions

| ADR                                                    | Decision                                                                             |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| [0001](docs/adr/0001-snapshot-native-engine.md)        | Snapshot-native engine: the feed has no deltas, so the book is a fold over snapshots |
| [0002](docs/adr/0002-integer-raw-tick-prices.md)       | Prices are integer raw ticks; a float never indexes a level                          |
| [0003](docs/adr/0003-data-state-rendering-layers.md)   | Data / state / rendering, one way                                                    |
| [0004](docs/adr/0004-canvas-2d-worker-deferred.md)     | Canvas 2D on the main thread; a Worker stays deferred behind the renderer interface  |
| [0005](docs/adr/0005-size-delta-field-not-ofi.md)      | The size-delta field is not order-flow imbalance, and is not called it               |
| [0006](docs/adr/0006-synthetic-benchmarks-labelled.md) | Synthetic load is labelled synthetic                                                 |
| [0007](docs/adr/0007-four-streams-window-authority.md) | Four streams, each authoritative over its own window                                 |
| [0008](docs/adr/0008-react-chrome-patterns.md)         | React owns chrome only; frames are written by ref                                    |
| [0009](docs/adr/0009-visual-layer-ports-v4.md)         | The visual layer is a port of the v4 prototype; every deviation is recorded          |

Feed facts behind these — tick derivation, aggregation grids, observed cadences — are summarised in the quirks section below; the raw research notes are kept out of this repo.

## Quirks we hit

Things that cost real time, written down so they cost nobody else any.

**The venue**

- `l2Book` is a **full snapshot**, not a delta, and carries no sequence number. There is nothing to resynchronise against, so the book is a fold and out-of-order pushes are last-writer-wins. A scenario test states exactly that.
- Two subscriptions at different precisions are **indistinguishable on the wire**: same channel, same coin, no echo of the aggregation. Changing grouping therefore means unsubscribe, subscribe, and gate the incoming pushes on an on-grid check until the new grid is confirmed.
- `levels[0]` is bids descending and `levels[1]` asks ascending — **observed, never documented**. The wire layer asserts it instead of trusting it.
- The socket drops at 60 s of silence; a ping every ~50 s keeps it. `{nSigFigs: 5, mantissa: 1}` returns HTTP 500 with a null body, so the base grid omits the mantissa.
- `/info` **rate-limits hard**. Naively, mounting the widget fired four `/info` calls plus a 10 s stats poll and earned a 429 storm. One shared fetch now dedupes in-flight bodies, caches per payload type, and serves the last good body during a 30 s backoff.
- Spot markets are absent from `metaAndAssetCtxs` entirely; they need `spotMetaAndAssetCtxs`, whose contexts carry `midPx`/`prevDayPx`/`dayNtlVlm` but never funding. Pricing spot from `allMids` alone — as this did at first — yields a bare number with no 24 h change. `allMids` remains the fallback for pairs the venue publishes no context for, and spot rows whose token indexes are missing are skipped rather than half-built.
- Those spot contexts are **not parallel to `spotMeta.universe`**, which is the trap: the venue returned 330 listed pairs and 869 contexts, including pairs that are not listed at all. A positional join therefore reads a different market's row and is wrong _silently_ — HYPE/USDC showed a 0.0819 mark against a 96.89 mid and "0.0M" of volume, which looks like a formatting bug rather than a mis-join. Every context names itself in `coin`; that is the only safe key. A regression feeds contexts that are longer than, and out of order with, the universe.
- Trades and book pushes have **no guaranteed causal order**, so "consumed vs cancelled" can only ever be a temporal join with a 600 ms grace window — and it is labelled a heuristic everywhere it appears.
- **A row's present must not edit its past.** `drawLadder` skipped the rest of a row's body when the level was empty — no size, no pulses — and the trail strip was the last thing in that body, so a level's painted history vanished the instant its liquidity dried up and reappeared if it refilled. The history was never lost: it is keyed by price in `level-history`, and the row still carried it. Only the paint was skipped. The same early return hit a price swallowed by a widening spread, defeating the comment inside `trailStrip` that promised exactly that case would be drawn. Every row now falls through to the strip.
- Trail history was keyed by `(side, price)` but looked up with the side the row has _this frame_. The two agree until the touch moves — so a sweep blanked the column for every price whose side flipped, and a widening spread blanked every price it swallowed, while the samples sat intact under the old key. Replaying one recording: 4,164 blanked row-frames out of 163,852, plus 1,644 inside the spread; both zero after the fix. Trails are now keyed by price, each sample remembering the side it was taken on, and live state stays per side (ADR 0009).
- Trail tiles used to be shaded against the _current_ frame's largest level, so painted history changed colour whenever something bigger appeared or aged out — a level that was hot when it happened would turn side-coloured a second later and back again. With the mid frozen, the scale swung 16.4 → 10.2 → 17.1 in two seconds and re-shaded every tracked tile. Shading is now frozen into the sample when it is taken (ADR 0009). History is a record; only live cells normalise against the live frame.
- The mid crossing a power of ten changes what a fixed `nSigFigs` means, so the grid is re-derived when the decade changes — in the subscription gate as well as the engine. Conformance is checked against the grid, not the precision, so a gate still holding the boot-time step rejects every price that is valid on the new one and the ladder simply stops. The adapter follows the decade from `bbo`, which is not gated, so the new grid is in force before the first book push that uses it.
- Desired precision is not transport state. A grouping chosen while the socket is down has to survive the reconnect; mutating the doomed subscription loses it silently, and the user gets their old grouping back with no error to explain it.

**The engine, under load**

- The burst benchmark, not a unit test, exposed the real scaling wall: the attribution join and the metric windows were **arrays that got scanned**. A 15 s print window at one price, a 60 s decrease window per side, and a grace list of open decreases are all trivial at the live 30 events/s and all quadratic when the rate climbs. Indexing them — prints by price with prefix sums and binary search, decreases by price with a cursor, the ratio window as fixed 250 ms buckets — took apply p50 from rate-dependent milliseconds to a flat ~4 µs, and sustained throughput at a synthetic 100k events/s from 1,388 to 28,653 events/s — a 20x improvement that no amount of profiling the render path would have found.
- There is still a floor, and it is honest: a 15 s window at 100k events/s is inherently ~10⁶ retained prints, so above ~50k events/s the cost is allocation and GC, not lookup. That floor is visible in the table: apply p50 stays flat while sustained throughput falls as the heap fills. The table below shows it as heap delta, and the numbers are from a laptop 4700U, not a server.
- A burst harness that omits the host `tick` measures an engine that never prunes. That is a bug in the harness, not headroom in the engine.

**The widget**

- Presentation ingestion must not be welded to painting. Folding engine output into pulses, trails and tape inside the paint path means every skipped frame — a hidden tab, a quiet book under the `on update` cadence — silently skips ingestion too: the trail column grows holes for time that was never sampled, and the engine's queues grow with no consumer. `ingest` runs on a timer, `project` runs on paints.
- Pause is an easy thing to get backwards. Dropping events at the feed listener looks like "pause" and is actually data loss: the book silently diverges from the venue, and resuming shows a stale market. The ingest path and the presentation path have to be paused separately, and only the presentation one should ever stop.

**The browser**

- The canvas is DPR-scaled: Playwright's `clip` is CSS pixels while `getImageData` is device pixels. Mixing them silently samples the wrong place.
- A hidden tab throttles `requestAnimationFrame`, so returning to one would otherwise replay minutes of animation. The first visible frame folds what queued and settles.
- Icons cannot be drawn from a DOM icon set onto a canvas, so direction marks are drawn paths; the DOM chrome uses `lucide-react`.
- A React root's `display` rule beats `[hidden]`; the metrics panel is mounted only while metrics are on.
- Fixture feeds can only honour their recorded precision, so during replay the segment shows the _requested_ grouping while the dot reads `RESYNCING`.

## Proof

- **Replay invariants** — every recording in `fixtures/` is folded event by event, asserting sorted sides, an uncrossed touch, on-grid prices, monotone cumulative depth, and at most one version bump per applied event.
- **Scenario tests** — deliberately broken copies of a recording: duplicated push, non-monotonic push, garbage line, structurally wrong frame, off-grid price, drop and reconnect. Each states what is dropped and what the book looks like afterwards.
- **Property tests** — tick round-trips, diff reconstruction, URL round-trip.
- **End to end** — rows paint, grouping resubscribes, the pair picker resets the book, a shared link's grouping survives a load, the phone layout reaches LIVE and paints the spine, the widget is fully operable from the keyboard, and twenty mount/unmount cycles release every listener, timer and observer.

## Benchmarks

Generated by `npx vite-node scripts/bench.ts`, never typed by hand (ADR 0006). Benches are run on demand, never in CI, and the results JSON is committed. The render scope is deliberately narrower than the proof surface first called for; [ADR 0006](docs/adr/0006-synthetic-benchmarks-labelled.md) records why, and the table states what was not measured.

<!-- bench:start -->
Measured on AMD Ryzen 7 4700U with Radeon Graphics (8 cores), Node v26.8.1, 2026-09-24.

**Engine burst — synthetic.** Real frames from `fixtures/btc-perp-active.jsonl.gz` re-stamped onto a faster clock and replayed back to back. The live feed peaks near 30 events/s, so these rates say how much headroom there is, not what the venue does.

| Synthetic rate | Sustained | apply p50 | apply p99 | Heap delta |
| --- | --- | --- | --- | --- |
| 1,000/s (33x live) | 80,139/s | 4.33 us | 88.8 us | -11.1 MB |
| 10,000/s (333x live) | 97,709/s | 3.35 us | 66.3 us | 15.2 MB |
| 50,000/s (1667x live) | 49,089/s | 3.35 us | 178.44 us | 14.8 MB |
| 100,000/s (3333x live) | 33,395/s | 3.35 us | 292.4 us | 136.5 MB |

**Render — emulated.** The widget replaying `btc-perp-active.jsonl.gz` at speed 1 in headless Chromium, telemetry read from its own HUD.

Scope: two viewports at the 60 fps cadence, sampled for 15 s after a 5 s warm-up. The 30 fps and on-update cadences and the trails/tape permutations are **not** benchmarked — they reduce work rather than add it, so the figures below are the expensive case. `frame p50` and `frame p95` are medians of the HUD's rolling per-frame percentiles across the run, not percentiles over every frame in it.

| Viewport | fps | frame p50 | frame p95 |
| --- | --- | --- | --- |
| desktop 1500x820 DPR 1, 60 fps cap | 60 fps | 3 ms | 4 ms |
| phone 390x844 DPR 3, 60 fps cap | 60 fps | 1.1 ms | 1.4 ms |
<!-- bench:end -->
