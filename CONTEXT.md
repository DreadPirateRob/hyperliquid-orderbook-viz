# Order Book Observatory

A browser-based market microstructure observatory for one Hyperliquid market at a time: not a table of prices, but a view of where liquidity is, how long it has been there, how it is changing, and what happens when trades meet it.

## Language

### Feed

**Book push**:
One full `l2Book` snapshot from Hyperliquid: both sides, up to 20 levels each, with a block `time`. The feed sends whole books, never deltas.
_Avoid_: update, delta, message

**Level**:
One resting price on one side of the book, with its size and order count (`n`).
_Avoid_: row (that is a ladder concept), order

**Tick**:
The smallest price increment for a coin at the current precision. Prices are held internally as integer tick counts.
_Avoid_: pip, step

**Precision**:
The `nSigFigs` setting that controls how many significant figures the feed rounds prices to. Changing it changes the tick.
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
What the diff says happened to a level: added, grew, shrank, vanished, consumed (shrank or vanished at a price where a trade occurred), cancelled (shrank or vanished with no trade there).
_Avoid_: update, change

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

**Presentation frame**:
The per-animation-frame sample of engine state plus animation state that the renderer draws. Never stored; derived from `(engine state, now)`.
_Avoid_: view model, render state

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

**Microprice ribbon**:
The spread row: mid, microprice, spread, and top-of-book imbalance drawn together.

**Fill marker**:
The pulse drawn at a ladder row when a trade hits that price.

**HUD**:
The optional engineering panel showing connection, feed, engine, and renderer telemetry.
_Avoid_: diagnostics panel, debug panel
