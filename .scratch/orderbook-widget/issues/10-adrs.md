# Adrs

Type: task
Status: resolved
Blocked by: 03, 04, 05, 06, 07, 08, 16, 17

## Question

Write ADRs 0001–0008 from the resolved decision tickets (snapshot-native engine; integer raw-tick prices; engine outside React; Canvas 2D with Worker deferred; size-delta field not OFI; synthetic benches labelled; four streams by window authority; React chrome patterns), plus **ADR 0009: the visual layer is a port of prototype v4** — `prototype/ladder-prototype-v4.html` `sample`/`draw` code is the source of truth for look and motion; the build transliterates it and passes a side-by-side parity check; re-deriving visuals from prose is prohibited. Evidence: the abandoned first build (`attempt/react-v1`, reference only, never a source of code). Use `grill-with-docs` conventions for ADR shape and glossary updates.

## Answer

Nine ADRs in `docs/adr/`, written fresh from the decision tickets (nothing consulted on `attempt/react-v1`):
0001 snapshot-native engine; 0002 integer raw-tick prices; **0003 three layers — data / state / rendering** (user interjection: clear split; dependencies point rendering → state → data; v4's `hist` animation map lives in the state layer, per Q2 of this grilling); 0004 Canvas 2D, Worker deferred; 0005 size-delta field, never OFI; 0006 synthetic benches labelled; 0007 four streams by window authority; 0008 React chrome patterns (the five seams decided with the user in attempt one, kept per Q3; no tooltip — hover row only); **0009 the visual layer is a port of prototype v4** (Q1: port `sample` + draw + `loop`, behaviour and constants copied; code shape rewritten to the coding-standards skill, behaviour wins on conflict; parity gate per slice; no unattended agents on the visual path; nothing reused from `attempt/react-v1`).
Glossary gained: data/state/rendering layer, frame sample, parity gate.
