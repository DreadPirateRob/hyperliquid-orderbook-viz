# Feed Cadence Strategy

Type: grilling
Status: resolved
Blocked by: 01

## Question

Research measured the 20-level `l2Book` at ~5.4 s median between pushes and `fast: true` at ~0.54 s with only 5 levels; `bbo` is per-block on change and `trades` are per-block. That is far slower than the 2 Hz the map assumed. Decide the subscription set and how the engine fuses them:
- **Dual book**: subscribe both slow (20 levels) and fast (5 levels) for the same coin and merge: fast top-5 overwrites the slow book's top-5 between slow pushes. Does the "two indistinguishable l2Book streams on one socket" finding apply (fast vs slow differ in level count, so are they distinguishable)? Cost: two sockets if not.
- **Fast only**: 5 levels at 2 Hz; lose the deep profile.
- **Slow + bbo + trades**: keep 20 levels, let bbo/trades animate the top between pushes; deep levels update every ~5 s.
- Consequences for: diff semantics when the top-5 and the 20-level views disagree, persistence bookkeeping across two cadences, what "stale" means per stream, what the HUD shows per stream, and fixture recording (all streams must be captured).

## Answer

Probe (15 s, one socket, BTC): slow and fast `l2Book` coexist cleanly; fast messages carry `fast: true` in `data`, slow ones omit it. 4 slow (20×20) and 28 fast (5×5) in 15 s. No second socket needed.

1. **Subscription set**: slow `l2Book` (20 levels) + fast `l2Book` (5 levels) + `bbo` + `trades`, one socket. Three cadences at the top of book: BBO ~71 ms, fast ~540 ms, slow ~5 s.
2. **Fusion = window authority**: newest stream wins inside the price window it covers. BBO owns the best level per side; fast owns best→5th price; slow owns beyond. A fast push removes any slow level inside its window that it doesn't list. A slow push replaces the side, then the current fast window is re-applied if fast is newer.
3. **Lifecycle events** emit on every merged change, tagged with producing stream (`bbo` / `fast` / `slow`). Persistence, resiliency, size-delta field and HUD weight/report by tag.
4. **Staleness per stream**: STALE if fast silent > 3 s or slow silent > 20 s (tunables). BBO/trades never trigger STALE (silence is legal); HUD shows last-seen age. RESYNCING on socket loss: resubscribe all four; first fresh slow push is the new baseline; fast pushes before it are held.
5. **Precision change**: unsubscribe/resubscribe both book objects; ladder resets on the first new fast push, body fills on the first new slow push. Input to Precision Change Semantics.
6. **Fixtures**: one interleaved JSONL per recording with client receive time + server time across all four streams; replay fuses through the same engine. Input to Proof Surface Design.
