# ADR 0003: Three layers — data, state, rendering

Status: accepted

## Context

Feed events arrive at up to ~30/s live (bbo ~70 ms) and orders of magnitude faster in benchmarks; pixels are canvas-drawn. The first build attempt blurred responsibilities across its seams and lost the prototype's motion in the gaps. The user requires a clear split between the data, state, and rendering layers.

## Decision

Three layers, each a plain TypeScript module boundary, none owned by React:

1. **Data layer — facts.** Feed adapter (socket, acks, resubscribes, REST) and engine (book fusion, lifecycle events, history, metrics). Pull API — `apply(event)`, `snapshot()`, `drain()`, `metrics()`, `reset()` — that never reads a clock (time arrives on events, incl. a host `tick(now)`). Knows nothing of animation, layout, or pixels. All I/O types structured-clone-safe so the layer can move behind `postMessage` without interface change (ADR 0004).
2. **State layer — what the screen should show now.** Widget state (reducer + URL), prefs (external store), and the v4-ported sampler: per-price animation map (`hist`: springs, pulses, trails), anchor, layout, tape aggregation. Consumes data-layer facts, produces one frame sample (v4's `S`) per tick. No DOM, no canvas, no I/O.
3. **Rendering layer — pixels and DOM.** Stateless draw functions over the frame sample (v4's `drawLadder`/`drawSpine`/`drawTape`/`ribbon1`) on two canvases, plus the React chrome (ADR 0008). Never touches the book or the socket; everything it paints is in the sample.

Dependencies point one way: rendering → state → data. Per this grilling (ADRs ticket, Q2): the per-price animation map stays in the **state layer**, not the engine — two price-keyed stores exist by design (engine facts, animation state) with one seam between them; merging them would leak animation into the data layer and break the Worker option.

## Consequences

- The frame path allocates no React work; tests and benchmarks run each layer headless (engine against fixtures in Node; sampler against synthetic facts; renderer against a canned sample).
- A layer is replaceable behind its seam: engine into a Worker (transport change), renderer to WebGL (paint change), chrome re-skinned — without touching the other two.
- Any PR that makes rendering read the book, or the engine know about springs, violates this ADR.
