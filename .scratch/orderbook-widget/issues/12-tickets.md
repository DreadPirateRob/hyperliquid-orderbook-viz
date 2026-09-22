# Tickets

Type: task
Status: resolved
Blocked by: 11

## Question

Use the `to-tickets` skill on the spec: tracer-bullet **vertical** slices (feed → engine → sample → draw → chrome → test for one visible behaviour each), each demoable alone, sized to one context window, with blocking edges, quizzed with the user before publishing. The first slice is the thinnest end-to-end path: live socket → engine → ladder rows drawn on canvas at v4 fidelity for one coin. Every visual slice carries a parity criterion (v4 side by side, screenshot, user sign-off). Replaces the horizontal split used in the first attempt.

## Answer

Eleven tracer-bullet tickets published via `to-tickets`, approved by the user as drafted: 18 Scaffold and contracts → 19 Ladder rows on screen → 20 Level motion → {21 Trails and boundary, 22 Trades tape, 24 Spine view} → 23 Overlays and HUD; 25 Grouping and precision change and 26 Pairs/REST/URL/prefs after 19; 27 Responsive/touch/a11y after 21–24, 26; 28 Proof after 25, 27; then Review, Deploy. Every ticket carries the working rules: `implement` skill, coding-standards + TypeScript (+ React) skills on every line, TDD at the spec seams, typecheck + touched tests per step, one atomic commit per step, full suite + `code-review` at ticket end, parity gate with user sign-off on visual tickets, no unattended agents on visuals, nothing from `attempt/react-v1`.
