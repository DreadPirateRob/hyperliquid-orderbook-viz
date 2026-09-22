# Implementation

Type: task
Status: open
Blocked by: 09, 12

## Question

Umbrella. First act on claiming: split into ordered sub-tickets. Fixed shape of the split (from the retrospective in the map Notes):
1. **Feed adapter + REST + fixture reader** — salvage from `attempt/react-v1` (`src/feed/*`), keep its tests; port v4's socket/ack/resubscribe logic only where the salvaged adapter deviates from v4's observed behaviour.
2. **Engine core + metrics** — salvage from `attempt/react-v1` (`src/engine/*`, 18 tests over all fixtures); verify `hist`-equivalent semantics against v4's `apply*` functions.
3. **Port v4 sample + draw** — the visual layer, transliterated from `prototype/ladder-prototype-v4.html` line for line: `sample(dt)`, `heatColour`, `pulseState`, `persistence`, `trailStrip`, `drawLadder`, `drawSpine`, `drawTape`, `ribbon1`, `shareBar`, `drawShapePanel`, `loop()`. Every constant, alpha, curve and pixel offset copied. Typed arrays replace per-frame objects; integer ticks replace floats; nothing else changes. **Parity gate**: v4 and the port side by side on the same live feed, screenshots per stage (rows → springs → trails/paths → boundary → tape → spine), user signs off before the next sub-ticket. No AFK agents on this ticket.
4. **Chrome** — React owns exactly what v4's DOM owns: top bar (pair popover, stats, grouping, view, toggles, gear, connection, pause), HUD text + shape panel, keyboard map. Canvas mounted once; state via `update()` into the loop; no React on the frame path; lucide-react icons. No tooltip; hover row only.
5. **Tests + benchmarks + README table** per Proof Surface Design.
