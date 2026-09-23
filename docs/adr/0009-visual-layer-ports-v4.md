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

## Amendment (Trail window is 30 s, not v4's 12 s)

Twelve seconds shows a sweep or its aftermath, rarely both. Thirty holds the excursion and the recovery in one view, which is the span worth reading when the question is "what happened at this price".

The window is the only constant that changes: sampling stays at `TRAIL_DT`, so a level now retains 120 samples instead of 48, and a tile is `w / 120` of the trail column. Measured across the widths that show trails at all (the column is dropped below 900 px), a tile is 5.25 px at 1500 px, 3.42 px at 1280 px, and 1.92 px at the 900 px breakpoint itself — the only width where it falls under the 2 px floor `trailStrip` enforces, and a 4 % overlap there is not worth a second constant.
