# ADR 0009: The visual layer is a port of prototype v4

Status: accepted

## Context

The first build (branch `attempt/react-v1`, later abandoned) re-derived the visual layer from the written spec via delegated agents. Look and motion diverged badly: animation state keyed by row instead of price (snapping, melting bars), trails stepping once per sample, a permanent dim veil, invented surfaces (tooltip, spine trails/tape). Each was patched toward the prototype after the fact and the result still wasn't the prototype. Prose is a lossy encoding of motion; `prototype/ladder-prototype-v4.html` (branch `prototype/ladder`, `802ae3c`) is the artifact the user approved.

## Decision

v4 is the **source of truth for behaviour and constants** of everything from feed events to pixels: `sample(dt)`, `heatColour`, `pulseState`, `persistence`, `trailStrip`, `drawLadder`, `drawSpine`, `drawTape`, `ribbon1`, `shareBar`, `drawShapePanel`, and the `loop()` cadence rules. Every constant, alpha curve, easing, and pixel offset is copied, not re-derived. v4's `sample(dt)` becomes the state layer's sampler and its draw functions become the rendering layer (ADR 0003); the per-price animation map (`hist`) is ported as-is into the state layer.

The **code shape** is rewritten to this repo's standards (coding-standards skill): integer ticks (ADR 0002) replace floats, typed arrays and pre-allocated stores replace per-frame objects, errors-as-values at the adapter, domain modules for pure calculation, JSDoc on exports. Where standards and v4 conflict, **behaviour wins** and the deviation is recorded here.

Process rules, from the retrospective:

- Re-deriving visuals from prose is prohibited.
- The visual path is never delegated to unattended agents.
- Every visual slice ends at a **parity gate**: v4 and the port side by side on the same live feed, screenshots per stage, user sign-off before the next slice.
- Nothing is copied from `attempt/react-v1` (user's decision); it is a post-mortem reference only.

## Consequences

- The port can be verified mechanically (constants diffed against v4) and visually (parity gate).
- v4 stays checked in on `prototype/ladder` and `prototype/` stays git-ignored on master; the port cites v4 function names in comments so drift is traceable.
- Spec sections about visuals point at v4 functions instead of re-describing them.

## Amendment (Centre spine view)

v4 keeps the tape column visible in the spine view. The user's standing preference is that the spine carries no trails and no tape, so the port hides both there **and** reclaims their columns: the spine centres in the full canvas width. Everything else in `drawSpine` (gap 60, half capped at 420, profile alpha 0.07/stroke 0.45, heat, pulses, size labels outboard, ruler lines, boundary with the last-trade tag at `cx + 30` and the share bar at `cx − 300`) is v4's.

## Amendment (Last-trade tag alignment)

v4 places the last-trade tag at `row ? row.y + ROW/2 : S.ribY`. `ribY` is a row **top**, so whenever the last print is not on a visible row — the usual case right after the price leaves the window — the pill renders half a row out of alignment with the ladder. The port keeps v4's on-row placement and replaces the fallback with the nearest row centre (`tagY`), so the tag is always on the row grid.

## Amendment (Trail shading is frozen at sample time)

v4 shades every trail tile against the frame it is being drawn in: `rel = s.sz / S.maxSz`, where `maxSz` is the largest level inside the ruler _right now_, multiplied by the row's _current_ persistence. A trail sample stored only `{t, sz}`, so the whole painted history was re-derived from the present frame, every frame.

That makes history move under the viewer. Measured on `btc-perp-quiet` with the mid frozen, `maxSz` swung 16.4 → 10.2 → 17.1 over two seconds; of 43 tracked `(price, sample time)` tiles, the old rule re-shaded **43 of 43** and flipped **5** across the amber threshold in either direction — a level that was hot when it happened turned side-coloured seconds later because something larger appeared elsewhere, then turned hot again when it left.

The trail column is a record of what happened. `rel` and `sat` are therefore computed once, when the sample is taken, and stored on it; the renderer reads them and never recomputes. Under the same measurement the new rule re-shades 0 of 43. Live cells — the heat block, the spine — still normalise against the current frame, because they _are_ the current frame.

The cost is accepted and real: tiles from different moments no longer share one denominator, so comparing two columns of the strip compares sizes normalised at their own instants rather than on a single scale. Stability of history was judged worth more than a common scale across the trail window.

The sampling denominator is the last projected frame's `maxSz` (at most one sample stale, since trails are sampled on the ingest timer rather than at paint). Before the first projection there is no ruler, so the largest live level stands in.

## Amendment (Trails are keyed by price, not by side)

v4 keys level history by `(side, price)` and looks a row up with the side the row has _this frame_ — `hist.get(key(side, px))`, with spread rows short-circuited to `null`. The row's side is recomputed from the live touch every frame, while history is written under the side the level had when the event arrived. The two disagree exactly when the touch moves.

So a sweep blanked the column. A price that was an ask and is now a bid looked up a key nothing had ever written; the samples were still held, intact, under the old side. A price swallowed by a widening spread lost its history for the same reason, having no side to look up at all. Replaying `btc-perp-active` through the sampler: of 163,852 row-frames, **4,164** rendered blank while that price had trail samples under the other side, and **1,644** blanked inside the spread. Both counts are zero after the change.

A trail is the record of what happened at a **price**, so it is stored per price. Live state — size, spring, pulses, ghost width — stays per side, because it describes a resting order on one side of the book and nothing about it survives the flip. Where both sides hold an entry for one price (the level just flipped and the old side is a zero awaiting its 60 s eviction) the live entry speaks for the price, and the more recently changed one breaks the tie.

Each sample records the side it was taken on, and the renderer colours the tile from that rather than from the row. A sweep therefore leaves a legible seam — ask-coloured history above bid-coloured history at the same price — instead of repainting the past in the new side's colour, which would undo the freeze decision recorded above. Spread rows draw their trail for the same reason: the moment a level is swallowed is the moment most worth seeing.

## Amendment (Trail window is 60 s, not v4's 12 s)

Twelve seconds shows a sweep or its aftermath, rarely both. Sixty holds the excursion, the refill and the quoting that settles afterwards in one view, which is the span worth reading when the question is "what happened at this price".

Sampling stays at `TRAIL_DT`, so a level retains 240 samples instead of 48 and a tile is `w / 240` of the trail column. Measured across the widths that show trails at all (the column is dropped below 900 px): 2.62 px at 1500, 1.71 px at 1280, 1.79 px at 1100 where the tape's 200 px is returned to the ladder, and 0.96 px at the 900 px breakpoint itself.

That forced a second constant after all. `trailStrip` floored a tile at 2 px, which was under the pitch at 30 s and is now above it at every width but 1500: at 900 px each column would be covered by ~2.1 tiles, and since tiles are drawn with alpha the strip would composite into a band denser than any sample in it — history made up out of overlap. The floor is therefore 1 px, under the pitch everywhere, so tiles meet without overdrawing. The floor exists only to keep a sub-pixel tile visible, so lowering it costs nothing.

The window stays under `DEAD_MS` (60 s) only by coincidence of equality, and nothing depends on the relation: entries hold live animation state per side, while trails are stored per price and pruned solely by `TRAIL_MS`. An evicted entry stops contributing new samples, which for a level at zero were `rel: 0` and drew nothing.

## Amendment (History survives a grouping change)

Changing the grouping used to be as destructive as changing the market: `reset("grid")` cleared the level history, so the trail column went blank and refilled from nothing. It never needed to. Grouping is a display choice, and the tape and the touch trail already outlived it.

What makes carrying the rest safe is that **an instant belongs to exactly one grid**. `sampleTrails` writes every price's sample for a frame under a single timestamp, so samples taken before a change and samples taken after it never share an instant and can never be double-counted. After a change the strip reads as old grouping to the left, new grouping to the right — the resolution change is itself visible, which is honest.

The two directions are not symmetric, and the asymmetry is in the data, not the code:

- **Coarser by a whole multiple is derivable and exact.** Summing the finer trails per timestamp is precisely the trail the coarse grouping would have recorded, so they are merged and the distinction disappears. Sizes are exact. Shading is not: the ruler's largest level under the coarse grouping was never observed, so `rel` keeps the denominator in force when it was sampled — the freeze rule above — and saturates at 1 where a summed bucket outgrows the largest single level of its own time.
- **Finer is not derivable at all.** Hyperliquid aggregates server-side: at `nSigFigs: 5` the sub-buckets never reached this client, so there is nothing to un-merge and no amount of work will produce it. The same holds for a step that is not a whole multiple, `$2 → $5`.

Undrawable history is not discarded, because it is still true — it just says something weaker. Those samples are kept as **bands**, keyed by the bucket price they were recorded at, covering `[px, px + g)` for a bid bucket and `(px - g, px]` for an ask (bids round down, asks round up, as both venues aggregate). The renderer draws a band at full row height with no inset, so the rows it covers join into one unbroken block spanning the prices the bucket held, while present-grid tiles keep their inset and are drawn over it. A band says "this much stood somewhere in here"; splitting it across rows would say where, which nothing recorded.

A band is drawn once, as one block spanning the rows it covers, and the store is what makes that possible: rows under one bucket are handed the _same_ sample array, so the renderer groups a run by identity. Drawing it per covered row instead is both a worse picture — ten seams where there is one block — and measurably slower. Measured on live BTC at 1500x900, five seconds of `requestAnimationFrame` pacing right after `$10 → $1`: per-row drawing landed **248 frames of 300 with a p95 of 33.4 ms**, i.e. dropped frames, against 300 of 300 at p95 16.8 ms in steady state. Drawing each band once restores 300 of 300 at 16.8 ms, indistinguishable from no bands at all. The first attempt kept the two sides in one array per bucket, which defeated the sharing — a row inside a bucket is covered by its bid samples but not its ask samples, so every row rebuilt a merged array — hence bid and ask are stored apart and coverage is pure arithmetic.

Rejected: painting the coarse sample on the row that happens to match its bucket price. It is the cheapest option and it lies — it implies one price held depth that belonged to a whole band.

Bands age out on `TRAIL_MS` like everything else, so the column returns to a single grid within a window of the change, and `clear()` still drops them with everything else when the market changes.
