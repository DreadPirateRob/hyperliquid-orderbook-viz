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
