# Order Book Observatory

A browser-based market microstructure observatory for one Hyperliquid market at a time: not a table of prices, but a view of where liquidity is, how long it has been there, how it is changing, and what happens when trades meet it.

## Language

### Feed

**Book push**:
One full `l2Book` snapshot from Hyperliquid, with a block `time`. The feed sends whole books, never deltas. Comes in two forms: the **slow book** (up to 20 levels per side, ~5 s apart) and the **fast book** (5 levels per side, ~0.5 s apart).
_Avoid_: update, delta, message

**Stream**:
One of the four subscriptions the widget fuses for a coin: slow book, fast book, BBO, trades. Every lifecycle event carries the stream that produced it.
_Avoid_: channel, feed (feed is the whole set)

**Window authority**:
The fusion rule: the newest stream wins inside the price window it covers (BBO owns the best level, fast book the top five prices, slow book everything beyond).
_Avoid_: merge, overlay

**Level**:
One resting price on one side of the book, with its size and order count (`n`).
_Avoid_: row (that is a ladder concept), order

**Raw tick**:
The exchange's smallest price increment for a coin (`10^-(D - szDecimals)`). The engine holds every price as an integer count of raw ticks.
_Avoid_: tick (alone), pip, step

**Grid tick**:
The row spacing of the ladder at the current precision: derived from the mid price, `nSigFigs`, and mantissa. A presentation quantity; changes when price magnitude crosses a power of ten.
_Avoid_: bucket size, grouping

**Precision**:
The `nSigFigs` and mantissa pair the widget subscribes with; the feed rounds prices to it server-side. Selected indirectly through grouping. Changing it changes the grid tick, never the raw tick, and starts persistence fresh.
_Avoid_: grouping, aggregation, decimals

**Trade**:
One fill from the `trades` feed: price, size, side, time.
_Avoid_: execution, fill (except in "fill marker" below), print

**BBO**:
Best bid and best ask from the `bbo` feed, pushed per block when they change; arrives faster than book pushes.

### Engine

**Book engine**:
The pure-TypeScript module that consumes book pushes, trades, and BBO, maintains the current book, and derives all metrics. It runs outside React.
_Avoid_: store, reducer, state

**Diff**:
The comparison of a new book push against the previous one, producing lifecycle events per level.

**Lifecycle event**:
What the diff says happened to a level: added, grew, shrank, vanished, or out-of-window (left because the visible window moved, not because liquidity left). Every decrease carries a consumed part (matched to trades at that price in the interval) and a cancelled part (the remainder); the split is a temporal heuristic, never a proven cause.
_Avoid_: update, change

**Historical trades**:
The backlog of past trades Hyperliquid sends on `trades` subscription. Excluded from lifecycle joins and fill markers.

**Persistence**:
How long a level has rested unchanged at its price.
_Avoid_: age (acceptable informally), lifetime

**Resiliency**:
How quickly a level that was consumed or cancelled refills toward its prior size.
_Avoid_: recovery, replenishment

**Size-delta field**:
Net size change per price per book push, across the visible book. The snapshot-granularity stand-in for order-flow imbalance.
_Avoid_: OFI (we cannot compute true OFI from snapshots)

**Migration**:
A vanished level and a newly added level of matching size in the same or adjacent push, interpreted as liquidity moving between prices. A heuristic.

**Execution cost**:
The volume-weighted average price and slippage of sweeping the visible book for a given notional, per side.
_Avoid_: impact, cost surface

**Connection state**:
One of DISCONNECTED, CONNECTING, SUBSCRIBING, LIVE, STALE, RESYNCING. STALE means no book push within the staleness threshold; RESYNCING means the socket was rebuilt and a fresh push is awaited.

### Presentation

**Ladder**:
The fixed vertical price grid the widget draws. Rows are prices; data flows through them; the grid re-centres only when the best price drifts past a band.
_Avoid_: list, table, DOM

**Presenter**:
The stateful layer between engine and renderer: owns springs, pulses, the ladder anchor, and layout, and emits one frame per animation tick.
_Avoid_: view model, animator

**Frame**:
The typed-array output of the presenter for one animation tick, with dirty flags for the static and dynamic layers. Never stored across ticks.
_Avoid_: presentation frame, render state

**Renderer**:
The stateless painter that draws a frame onto the two canvases. Holds no animation or book state.
_Avoid_: view, canvas layer (that is a part of it)

**Render cadence**:
The user-selectable cap on how often the renderer draws (60 fps, 30 fps, on-update). Independent of feed cadence.
_Avoid_: refresh rate, throttle

**Pulse**:
A short decaying visual response to a lifecycle event or trade at a ladder row.
_Avoid_: flash, blink

**Heat cell**:
The per-row colour swatch whose intensity encodes size at that level.

**Depth profile**:
The cumulative-size stair-step drawn behind the ladder, one side warm, one cool.

**Depth ruler**:
A horizontal marker at a fixed distance from mid, labelled with cumulative volume to that point; rows beyond it are dimmed.

**Boundary**:
The bid/ask gap in the ladder, drawn as a line with the bid and ask price paths, the last-trade tag, and the stacked share bar around it. Reads BBO and trades only; a readout, never a control.
_Avoid_: ribbon, spread row, mid row

**Share bar**:
The vertical stacked bar at the boundary: ask part above, bid part below, split at the bid share (`bidSize / (bidSize + askSize)`).
_Avoid_: imbalance bar, µ marker

**Price path**:
The best bid and best ask traced over the trails window; the gap between the two paths is the spread.
_Avoid_: mid line, price line

**Grouping**:
The user-facing row step of the ladder, offered as five per-coin derived ticks labelled by that step ($1, $2, $5, …). Each option maps to one server precision; changing it resubscribes both books.
_Avoid_: precision (that is the server parameter), aggregation

**Trails**:
The optional per-row strip showing a level's size history over the last 12 seconds.
_Avoid_: history column, heat strip

**Tape**:
The optional column of recent trades, newest first, aggregated per block, price, and side.
_Avoid_: trades feed, prints list

**Top bar**:
The widget's control strip: market, grouping, view, panel toggles, connection state, pause, settings. Sourced from REST and adapter state; the only place that writes widget state.
_Avoid_: header, toolbar

**Spine view**:
The alternate ladder layout with prices on a central column and bids and asks growing outward.
_Avoid_: mirrored view, centre view

**Fill marker**:
The pulse drawn at a ladder row when a trade hits that price.

**HUD**:
The optional engineering panel showing connection, feed, engine, and renderer telemetry.
_Avoid_: diagnostics panel, debug panel
