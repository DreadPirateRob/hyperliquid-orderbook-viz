# 27: Responsive, touch and accessibility

**What to build:** Breakpoint collapse (tape → trails → overlays), spine below 600, bottom sheet below 900, pinch-to-group, hover-row highlight, keyboard map complete, focus management, canvas text alternative, live region ≤ 1 Hz.

**Blocked by:** 21, 22, 23, 24, 26

**Status:** ready-for-agent

Type: task
Status: open
Blocked by: 21, 22, 23, 24, 26

- [ ] E2E at 390×844 DPR 3 reaches LIVE and paints the spine
- [ ] Keyboard-only walkthrough passes

**Working rules (every ticket):** `implement` skill; `coding-standards` + `typescript-best-practices` (+ `react-coding-style`, `react-best-practices` for chrome) applied to every line; TDD at the spec's seams; `tsc -b` and the touched test files after each step; one atomic commit per step (`<slice>: <step>`), full suite + `code-review` skill at the end of the ticket; visual tickets end with a **parity gate** (v4 and port side by side on the same live feed, screenshots per stage, user sign-off) and are never delegated to unattended agents. Nothing from `attempt/react-v1`.
