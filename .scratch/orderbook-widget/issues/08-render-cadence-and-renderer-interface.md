# Render Cadence And Renderer Interface

Type: grilling
Status: open
Blocked by: 05

## Question

Define the renderer boundary: presentation-frame shape, which canvas layers exist and what invalidates each, how the rAF loop enforces 60 / 30 / on-update and `prefers-reduced-motion`, HiDPI handling, what telemetry the renderer reports to the HUD (fps, p50/p95, dropped, draw calls). Must leave the Worker/OffscreenCanvas move as a transport change.
