# ADR 0004: Canvas 2D on two layers; Worker/OffscreenCanvas deferred

Status: accepted

## Context

The prototype proved Canvas 2D handles the full ladder + trails + tape at 60 fps on one thread. WebGL and Worker/OffscreenCanvas add build and debugging weight with no demonstrated need.

## Decision

Render with Canvas 2D on two stacked canvases — static (grid, layout-dependent chrome) and dynamic (book-dependent paint) — with explicit CSS size × devicePixelRatio backing and `desynchronized` contexts. GPU-friendly habits: cached gradients, no per-frame readbacks, no per-frame allocation. Worker/OffscreenCanvas migration happens only if the render benchmark shows main-thread contention; ADR 0003's structured-clone-safe data-layer types keep it a transport change.

## Consequences

- No shader/WebGL toolchain; failure modes stay debuggable in DevTools.
- The render benchmark (Proof Surface Design) is the tripwire that reopens this decision.
