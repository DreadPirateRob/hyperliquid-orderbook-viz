# Render Cadence And Renderer Interface

Type: grilling
Status: resolved
Blocked by: 05

## Question

Define the renderer boundary: presentation-frame shape, which canvas layers exist and what invalidates each, how the rAF loop enforces 60 / 30 / on-update and `prefers-reduced-motion`, HiDPI handling, what telemetry the renderer reports to the HUD (fps, p50/p95, dropped, draw calls). Must leave the Worker/OffscreenCanvas move as a transport change.

## Answer

1. **Three layers**: `Engine` (pure data: `apply/snapshot/drain/metrics`) → `Presenter` (stateful: springs, pulses, anchor, layout; emits a typed-array `Frame` with `dirty: {static, dynamic}`) → `Renderer` (stateless: paints a `Frame` onto 2D contexts). Worker seam is transport-only, either Engine↔Presenter or host↔(Presenter+Renderer on OffscreenCanvas).
2. **Two canvases**: static layer (grid, price labels, rulers, ribbon chrome) redrawn only on layout change (resize, re-centre settle, grouping, toggles); dynamic layer (heat, blocks, profile, trails, tape, ribbon values, pulses) redrawn per frame under the cadence. Both DPR-scaled with explicit CSS `width/height` (prototype bug). `desynchronized: true`, no per-frame readbacks, cached gradients.
3. **Frame loop** owned by the host (React effect), not the renderer: per rAF `engine.apply(tick)` always (STALE on wall clock) → 30 fps cap skip → `presenter.sample(snapshot, drain, now)` → on-update skip if nothing dirty → `renderer.draw(frame)` (static layer only if `dirty.static`) → telemetry. `prefers-reduced-motion` forces on-update and snaps springs/pulses. Hidden tab pauses the loop; engine keeps ingesting; on return the presenter snaps, no catch-up animation.
4. **Telemetry** (one record, 2 Hz, HUD written via ref into a `<pre>`; the only per-frame-path DOM write): loop/renderer `fps`, frame p50/p95, `dropped` (budget-skipped), `drawCalls`, `staticRedraws`, `heapMB` where available; presenter `activeSprings`, `activePulses`; engine `applyP50/P95`, `eventsPerSec` per stream, dropped pushes, `histSize`. No React state changes on the hot path.
