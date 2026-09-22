# 24: Centre spine view

**What to build:** `v` / segment switches to v4's `drawSpine`: centred price column, bars outward, mirrored profile, no trails, no tape.

**Blocked by:** 20

**Status:** ready-for-agent

Type: task
Status: claimed
Blocked by: 20

- [ ] Layout test for spine geometry
- [ ] Parity gate signed

**Working rules (every ticket):** `implement` skill; `coding-standards` + `typescript-best-practices` (+ `react-coding-style`, `react-best-practices` for chrome) applied to every line; TDD at the spec's seams; `tsc -b` and the touched test files after each step; one atomic commit per step (`<slice>: <step>`), full suite + `code-review` skill at the end of the ticket; visual tickets end with a **parity gate** (v4 and port side by side on the same live feed, screenshots per stage, user sign-off) and are never delegated to unattended agents. Nothing from `attempt/react-v1`.
