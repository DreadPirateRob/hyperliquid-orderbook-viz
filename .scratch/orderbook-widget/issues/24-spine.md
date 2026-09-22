# 24: Centre spine view

**What to build:** `v` / segment switches to v4's `drawSpine`: centred price column, bars outward, mirrored profile, no trails, no tape.

**Blocked by:** 20

**Status:** ready-for-agent

Type: task
Status: resolved
Blocked by: 20

- [x] Layout test for spine geometry
- [x] Parity gate signed

**Working rules (every ticket):** `implement` skill; `coding-standards` + `typescript-best-practices` (+ `react-coding-style`, `react-best-practices` for chrome) applied to every line; TDD at the spec's seams; `tsc -b` and the touched test files after each step; one atomic commit per step (`<slice>: <step>`), full suite + `code-review` skill at the end of the ticket; visual tickets end with a **parity gate** (v4 and port side by side on the same live feed, screenshots per stage, user sign-off) and are never delegated to unattended agents. Nothing from `attempt/react-v1`.

## Answer

`render/spine.ts` ports v4's `drawSpine`: centred price column, depth outward (asks right, bids left) from ±60 px to at most 420, mirrored cumulative profiles (fill 0.07, stroke 0.45), heat and ghost/add/fill pulses in spine geometry, size labels outboard, full-width ruler lines, and the boundary with the last-trade tag right-aligned at `cx + 30` (v4's `ribbon1` ignores the `pxAlign` it is handed) plus the share bar at `cx − 300`. `v` key and segmented button switch views; `view=spine` in the URL. Per the standing preference the spine has no trails and no tape, and it reclaims their columns — recorded as an ADR 0009 amendment. Tests: `spineLayout` geometry at desktop and phone widths, plus a recording-context instrument (`render/tag-alignment.test.ts`) pinning tag geometry in both views. Two alignment bugs found and fixed during the gate: the `ribY` fallback put the tag half a row off the grid (now `tagY`), and the spine tag was centred instead of right-aligned. **Parity gate passed** (`/tmp/parity-24-{port,v4}.png`, `/tmp/spine-pill3.png`).
