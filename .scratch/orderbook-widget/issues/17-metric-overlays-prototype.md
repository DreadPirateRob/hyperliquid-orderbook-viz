# Metric Overlays Prototype

Type: prototype
Status: resolved
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

## Answer

Prototype v4 on branch `prototype/ladder` @ `b85ea22` (`prototype/ladder-prototype-v4.html`). **Default view is now ladder + trails + tape + overlays.** Layout with trails on: price | heat | trails (flush) | block column 300 px | tape 200 px.

### Overlays (kept)
- **Size-delta strip**: 4 px beside the heat cell, teal = pressure toward higher prices, rose = lower, alpha ∝ |F| / max|F| inside the rulers, threshold 3 %.
- **Resiliency bar**: 2 px under a block after a ≥ 50 % loss; grey track = 80 % target width, white fill = refill progress, teal when reached, amber when the 30 s cap hits.
- **Migration connector**: dashed vertical beside the heat cell from the vanished row to the added row with a dot at the destination, 600 ms decay, fast stream only. Rare on BTC (~1 per 40 s); kept.
- **Book shape**: mini canvas inside the metrics popover (ask curve above, bid below, `cvx` per side). HUD-only.
- **HUD lines**: `pressure`, `cancel% (by count / by vol)`, `refill@5s`, `convexity`, `cost`, `migrations`.

### Boundary (replaces the ribbon row; `ribH = 0`)
- **Bid and ask paths** over the trails window (rose / teal, glow + 1.25 px line), each with a small price tag at the "now" edge; the gap between the paths is the spread. No spread text.
- **Last-trade tag** on the price column at the row of the last print (`▲ 81241.0`, direction-coloured); mid in blue until the first trade. 1 px blue boundary line at the bid/ask gap.
- **Imbalance history** (insilico-style bars on the boundary): tried, then **removed**: it drifted off the BBO after re-centres and read as noise tiles. Imbalance is carried by the stacked share bar only.
- **Current share**: vertical stacked bar (10 × 44 px) in the label gutter, ask part above the boundary, bid below, height ∝ share, best sizes beside. No `%` or `µ` labels.
- **Removed from the boundary**: order-count dots (whole ladder), spread text, last-trade label at the right, execution-cost widget (two tried: text + hover card, then compact bars; neither earned its place). Execution cost stays in the HUD; its UI home is a build-time decision alongside the hover tooltip.
- **Layout with trails on is trails-first**: `trails | price | heat | bars | tape`, so the price column sits beside the bars. Trail tiles dimmed (peak alpha ≈ 0.48) so the paths keep ≥ 3:1 contrast over them. No time axis or labels on the trails column (tried a 2 s axis; removed).
- Final prototype commit: `prototype/ladder` @ `802ae3c`.

### Metric corrections found on live data (amend ticket 06)
1. **Cancel ratio by volume is ~100 % on BTC** (walls of 10–30 BTC flicker; fills are 0.001–0.05). Added a **by-count** form `1 − hits / decreases`; BBO-stream flicker is excluded from the join. Both reported; by-count is the honest headline.
2. **Trade attribution must be deferred**: pushes often arrive before the trades that explain them. Decreases stay open for a 600 ms grace window and are re-joined when trades land (`consumed` may grow, `cancelled` shrink). Engine rule.
3. **Convexity at fixed bps is meaningless** for a 20-level BTC book (~2.5 bps span). Redefined on the visible window: depth in the nearest 25 % of the visible price span / total visible depth.

### Deferred to the build
- Hover tooltip (order count `n`, level age, consumed/cancelled totals, cost details).
- Placement of the execution-cost readout.
