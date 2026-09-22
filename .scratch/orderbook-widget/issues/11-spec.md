# Spec

Type: task
Status: resolved
Blocked by: 10

## Question

Use the `to-spec` skill: synthesise the resolved tickets, ADRs, glossary and v4 into one build spec. The visual sections must reference v4 functions by name (`sample`, `heatColour`, `pulseState`, `persistence`, `trailStrip`, `drawLadder`, `drawSpine`, `drawTape`, `ribbon1`, `shareBar`, `drawShapePanel`, `loop`) and state which constants are copied verbatim. Written from scratch; the spec on `attempt/react-v1` is not consulted.

## Answer

Spec written via `to-spec` at [spec.md](../spec.md): problem, solution, 57 user stories, implementation decisions per layer (ADR 0003) with v4's constants enumerated as the contract (ADR 0009), feed/engine/chrome/replay decisions, and the four test seams confirmed with the user — widget entrypoint with injected fixture feed (E2E), fixture → engine, facts → frame sample, and the parity gate for pixels. Written fresh; nothing consulted on `attempt/react-v1`.
