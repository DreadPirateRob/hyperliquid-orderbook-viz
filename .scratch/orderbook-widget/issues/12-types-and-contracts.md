# Types And Contracts

Type: task
Status: resolved
Blocked by: 11

## Question

Scaffold Vite + React 19 + TS strict + Vitest/fast-check + Zod, and fix the contracts — **but only where v4 already has a seam**. v4's shapes are: feed events → `hist` (price-keyed level history with spring, pulses, trail) → `sample(dt)` returning `S` (rows, ruler max, boundary, tape rows, metrics `M`) → `drawLadder/drawSpine/drawTape/ribbon1(S)`. Contracts to write: `FeedEvent`, `Engine` (`apply/snapshot/drain/metrics/reset`, integer raw ticks), `Sample` = typed-array version of v4's `S`, `Renderer.draw(S)`. Do not invent seams v4 lacks (no separate "presenter" interface, no `dirty` flags, no transition machinery beyond v4's freeze-and-crossfade). Salvage from branch `attempt/react-v1`: `src/feed/schemas.ts`, `src/feed/types.ts`, `src/engine/types.ts`, `src/config.ts` — review each line against v4 before keeping it. Acceptance: `tsc -b`, lint, build pass; contract files cite the v4 line they mirror.

## Answer

Resolved by supersession. The seam types this ticket asked for were produced by ticket 18 as part of the scaffold and have been in use by every ticket since: `src/data/engine-api.types.ts` (snapshot, level events, metrics, engine handle), `src/data/feed-events.types.ts` (feed events and source), `src/render/draw.types.ts` (`DrawContext`, `Draw`) and `src/state/frame-sample.types.ts` (the per-frame sample). Writing them a second time in the abstract would have produced a contract nothing compiled against.
