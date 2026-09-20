# Precision Change Semantics

Type: grilling
Status: resolved
Blocked by: 01, 16

## Question

When the user changes nSigFigs: resubscribe with a new precision (server-side rounding) vs keep one high-precision subscription and bucket client-side? Consequences for tick unit, ladder reset vs animated re-bucketing, persistence history (does level age survive a precision change?), and what the HUD shows during the switch.

## Answer

1. **Server-side**: the dropdown unsubscribes both books and resubscribes with the new `nSigFigs`/`mantissa`. The engine never buckets. Local coarsening for a quick-grouping gesture is fog.
2. **Dropdown values**: `2, 3, 4, 5, 5×2, 5×5, full` (mantissa 1 omitted: live HTTP 500). Each option is labelled with the grid tick it yields at the current mid ("5 → $1", "5×5 → $5"), recomputed when the mid crosses a power of ten. Mantissa exists to fill the 10× gaps between `nSigFigs` steps ($1 → $2 → $5 → $10 on BTC).
3. **Persistence**: fresh start. Histories are keyed by raw tick; new levels after the change start new records; old ones age out by the retention rule. HUD shows "precision changed Ns ago". No merging of histories.
4. **Transition**: freeze and crossfade. Old ladder freezes and dims; connection state `RESYNCING` (reason `precision`); on first new fast push the grid re-lays out and the top 5 animate in; rows beyond stay dim placeholders until the first slow push. Overlapping subscriptions are rejected (indistinguishable on one channel).
5. **Grid change without precision change** (price crossing a power of ten at fixed `nSigFigs`): engine detects the grid-tick change on a push; same crossfade, fresh-start persistence, no RESYNCING; HUD shows "grid changed". Gets a fixture and a test.
