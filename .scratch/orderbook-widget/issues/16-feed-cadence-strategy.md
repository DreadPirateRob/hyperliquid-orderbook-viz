# Feed Cadence Strategy

Type: grilling
Status: open
Blocked by: 01

## Question

Research measured the 20-level `l2Book` at ~5.4 s median between pushes and `fast: true` at ~0.54 s with only 5 levels; `bbo` is per-block on change and `trades` are per-block. That is far slower than the 2 Hz the map assumed. Decide the subscription set and how the engine fuses them:
- **Dual book**: subscribe both slow (20 levels) and fast (5 levels) for the same coin and merge: fast top-5 overwrites the slow book's top-5 between slow pushes. Does the "two indistinguishable l2Book streams on one socket" finding apply (fast vs slow differ in level count, so are they distinguishable)? Cost: two sockets if not.
- **Fast only**: 5 levels at 2 Hz; lose the deep profile.
- **Slow + bbo + trades**: keep 20 levels, let bbo/trades animate the top between pushes; deep levels update every ~5 s.
- Consequences for: diff semantics when the top-5 and the 20-level views disagree, persistence bookkeeping across two cadences, what "stale" means per stream, what the HUD shows per stream, and fixture recording (all streams must be captured).
