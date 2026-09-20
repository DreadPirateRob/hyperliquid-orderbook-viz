# Metric Overlays Prototype

Type: prototype
Status: open
Blocked by: 05, 06

## Question

Extend the v3 ladder prototype (branch `prototype/ladder`) with the metric-driven visuals that Derived Metrics Definitions now specifies, and settle their look by reacting to them on live data:
- **Size-delta field** (`F[px]`, τ 3 s): a tint at the row's outer edge, sign = direction of pressure; how strong before it reads, how to keep it from fighting the persistence saturation.
- **Resiliency overlay**: after a ≥ 50 % loss, a bar that refills toward 80 % of `sizeBefore`; what it looks like when the cap (30 s) is hit.
- **Migration trails**: a decaying line between the vanished and added rows on a fast-stream pair; duration and thickness.
- **Book-shape sparkline + convexity** in the HUD or beside the rulers.
- **Execution-cost readout** in the ribbon (`buy $100k +3.2 bps · sell −2.9 bps`) with hover expansion (VWAP, fill %, levels), and the `exceedsVisibleDepth` state.
- **HUD additions**: `cancelRatio`, `pressure`, `refillAt5s`, `convexity`, churn per stream.
Output: prototype on the same branch plus a written list of chosen values, appended to this ticket.
