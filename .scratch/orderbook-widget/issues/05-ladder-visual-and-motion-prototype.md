# Ladder Visual And Motion Prototype

Type: prototype
Status: resolved
Blocked by: 02

## Question

Build a throwaway Canvas 2D prototype of the ladder driven by recorded or synthetic pushes and settle the visual language and motion by reacting to it: palette and intensity mapping, persistence saturation, heat cell / depth profile / depth ruler / microprice ribbon geometry, spring parameters for size and profile, pulse shapes and decay for each lifecycle event and fill markers, size-delta field and resiliency overlays, migration trails, book-shape sparkline, hysteresis re-centre animation, and how 60 fps / 30 fps / on-update modes differ. Output: a linked prototype plus a written list of the chosen values.

## Answer

Prototype: branch `prototype/ladder` (v1 `prototype/ladder-prototype.html` three structures; v2 `-v2.html` composed layout + ribbon variants + trails + tape; v3 `-v3.html` top bar, pair popover, prefs). Final commit `894baab`. All three run on live mainnet data; every value below was chosen by looking at pixels.

### Structure
- **Default view: classic ladder**. Row = price → heat cell (14 px) → size + order-count dots (`n`, max 6) → order block, with the cumulative depth profile drawn behind the block column. Rows never move; data flows through them.
- **Second view: centre spine**. Prices on a central column, bids grow left, asks right, profile mirrored. Same engine, same ribbon.
- **Trails** (toggle, off by default): a 12 s per-row size-history strip (250 ms cells; alpha = size/rulerMax, saturation = persistence; fills as white dots). Column order when on: price section → trails → block column fixed at **200 px** with the quantity and `n` dots at the end of each bar. Profile stays inside the block column.
- **Trades tape** (toggle, off): fixed **200 px** right column, newest first, cap 50. Row = age · ▲/▼ price (aggressor colour) · size (+`×N`) · size bar. Prints aggregate per (block time, price, side). Outliers ≥ P95 of last 5 min (armed at ≥ 20 prints) in amber + bold. Entry flash 350 ms; rows fade to 35 % over 60 s. Header aligned to the row columns.
- **Depth profile**: stair-step, gradient fill 0.18→0.03 alpha, 1 px outline at 0.5. Bids accumulate from best bid downward; **asks accumulate from best ask upward**.
- **Depth rulers** at ±R rows from mid (R = 12 default, user setting 4–40), 1 px white 0.19 alpha, Σ cumulative label at the outer row; rows beyond the ruler at 45 % alpha. Heat and block width normalise to the largest level *inside* the rulers (tapesurf rule).
- **Round-number emphasis**: prices at multiples of 10 grid ticks in white bold.

### Ribbon (own row, 36 px, at the bid/ask boundary)
- Mid at 18 px bold, at **raw-tick precision** (e.g. 81298.5). `SPREAD 1.0 · 10 ticks` in raw ticks.
- **Share bar**: one bar, bid colour from the left, ask from the right; the white divider is `bidSize / (bidSize + askSize)`, which is also the microprice position, so imbalance and µ are one glyph. Best sizes flank it; `µ <price> · <n>% bid` to the right.
- Last trade `▲/▼ <price>` at the right edge, coloured by direction. The ribbon is the only place *last* appears.
- **Ribbon reads BBO, never the grouped book**: BBO is its own state at raw precision and merges into the ladder only when its price lies on the active grid. Spread is therefore unaffected by grouping.
- Rejected variants (kept in v2 for reference): edge line + pill; side stat panel.

### Motion (all derived per frame from engine state + timestamps; nothing stored per frame)
- Size and profile: spring `k = 180, c = 24` on every level's displayed size.
- Ladder anchor: spring `k = 40, c = 13`; re-centre only when mid drifts past 30 % of the half-height (hysteresis).
- Pulses (exponential decay, τ): added = white outline τ 450 ms; grew = side-colour row flash τ 400 ms; shrank/vanished = ghost of the lost width τ 700 ms; consumed/fill = white tick beside the heat cell + amber row wash τ 500 ms.
- Persistence: saturation 0.35 → 1.0 over 20 s at the level's price.
- Outlier: level > 85 % of ruler-max shifts toward amber.
- Render cadence: 60 fps / 30 fps / on-update (redraw only when engine version or any spring/pulse is active). Frame cost on this laptop: ladder ~1.8 ms p50, +2.5 ms with trails, +0.5 ms with tape; 60 fps held in all modes.

### Palette (ours, not tapesurf's)
bg `#0b0e11`, panel `#0f1319`, line `#232b36`, text `#e5e7eb`, dim `#6b7280`, bid `rgb(45,212,191)`, ask `rgb(251,113,133)`, outlier `rgb(251,191,36)`, mid/ribbon `rgb(96,165,250)`. Dark only.

### Grouping
- Options are **derived per coin** from the tick formula over `{5, 5×2, 5×5, 4, 3}`, deduped, and **labelled by the resulting row step** (BTC `$1 $2 $5 $10 $100`; ETH `$0.1 $0.2 $0.5 $1 $10`). No `full` option. Default = finest. Rows step by exactly the chosen tick. Recomputed when the mid crosses a power of ten; the active segment flashes on a grid change.
- Control: segmented (all options visible), keys `[` `]`.
- **Change semantics** (verified against a raw socket trace): unsubscribe both books → full ladder reset (book, BBO, persistence, anchor; trades/tape survive) → subscribe both. Intake guards: (1) per-stream ack gate, an `l2Book` push is applied only after that stream's new subscription ack; (2) on-grid check, every price in a push must be a multiple of the active grid tick; (3) serialised resubscribes, a change while acks are pending is queued. Observed ack order: unsub-ack ×2 → sub-ack(slow) → slow push → sub-ack(fast) → fast pushes. The widget bootstraps at the default grouping, not full precision.

### Top bar (widget chrome, DOM, 44 px)
- Left → right: **pair trigger** (`BTC` + `PERP|SPOT` badge, ▾) · **mid** (large, from BBO) · REST stats mark / 24h % / 24h vol / funding (from `metaAndAssetCtxs`, refreshed 10 s) · **grouping segments** · **ladder | spine** · trails · tape · **metrics** toggle · spacer · **connection dot + state** (hover: per-stream ages) · **pause** (space) · **gear**.
- **Pair popover**: search (`/`), tabs Perp / Spot / ★ (favourites in `localStorage`), rows `market · price · 24h%`, ↑/↓ + Enter, Tab cycles tabs, Esc. Spot pairs supported (tick rule `8 − szDecimals`; spot moved from fog to in-scope).
- **Gear popover**: render cadence, ruler distance, execution-cost notional (10k/100k/1M), ribbon variant.
- **Metrics popover** stays anchored top-right, shifts left of the tape when the tape is on.
- **Authority split**: top bar = REST + adapter state, cadence of seconds, writes state; ribbon = BBO/trades per frame, reads only. Last price lives only in the ribbon; the bar shows mid + mark.
- **Persistence**: URL params for shareable state (`coin, view, trails, tape, g`); `localStorage` for preferences (`metrics, fps, ribbon, ruler, notional, favs`).
- Coin switch: unsubscribe all four streams, full reset (incl. tape and historical-trades flag), re-derive grouping from the new coin's mark, resubscribe.

### Renderer requirements surfaced
- Canvas must set explicit CSS `width/height` as well as backing-store size; without it a DPR ≠ 1 display clipped the right side of the widget. Goes into the renderer-interface ticket.
- Canvas sits below the 44 px bar; all geometry uses canvas height, not window height.

### Deferred / fog
- Quick-grouping drag gesture (still fog).
- Execution-cost readout in the ribbon once the metrics ticket defines it.
- OKX-style bar was the reference for stat pairs + pair popover; not directly inspected (geo-redirect), design taken from memory and marked as such.
