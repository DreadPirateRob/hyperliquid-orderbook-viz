# 27: Responsive, touch and accessibility

**What to build:** Breakpoint collapse (tape → trails → overlays), spine below 600, bottom sheet below 900, pinch-to-group, hover-row highlight, keyboard map complete, focus management, canvas text alternative, live region ≤ 1 Hz.

**Blocked by:** 21, 22, 23, 24, 26

**Status:** resolved

Type: task
Status: resolved
Blocked by: 21, 22, 23, 24, 26

- [x] E2E at 390×844 DPR 3 reaches LIVE and paints the spine
- [x] Keyboard-only walkthrough passes

**Working rules (every ticket):** `implement` skill; `coding-standards` + `typescript-best-practices` (+ `react-coding-style`, `react-best-practices` for chrome) applied to every line; TDD at the spec's seams; `tsc -b` and the touched test files after each step; one atomic commit per step (`<slice>: <step>`), full suite + `code-review` skill at the end of the ticket; visual tickets end with a **parity gate** (v4 and port side by side on the same live feed, screenshots per stage, user sign-off) and are never delegated to unattended agents. Nothing from `attempt/react-v1`.

## Answer

**Width policy** — `src/widget/responsive.ts`: `affordancesFor(width)` gives `tape >= 1280`, `trails >= 900`, `overlays >= 600`, a forced `spine` below 600 and sheet-form popovers below 900. It caps the user's toggles and never widens them: a column switched off stays off when the host grows. `src/widget/use-affordances.ts` observes the **root**, not the viewport (the widget is embeddable), and re-renders only when a breakpoint is crossed. A column the width cannot hold is not offered at all — its toggle is `disabled`, and `.orderbook-toggle:disabled { display: none }` takes it out of the bar.

**Touch** — `src/widget/pinch.ts` is a pure two-pointer tracker: 1.3 distance ratio commits one step and re-baselines, so one long spread walks the option list; options run finest first, so spreading reads as "finer". `touch-action: none` on the canvas keeps the gesture from scrolling the page. Below 600 px the segmented control is hidden and pinch replaces it.

**Hover** — painted on the canvas, since there are no DOM rows: `rowAtY` in `src/render/ladder.ts` resolves the row band, `drawLadder` paints a 6 % white band plus a left marker under the content, and `runtime.setHover` marks the frame dirty so the `on update` cadence still repaints for a pointer move that is not book state.

**Accessibility** — `src/widget/focus-trap.ts` traps Tab in both popovers at the document level, which also returns focus *into* the dialog when a refreshing market row is replaced under the cursor and focus falls to `body`; that was a real flake caught by the walkthrough, not a test artefact. The gear popover focuses its first control on open, both return focus to their trigger on Escape. The canvas carries a text alternative (`aria-label`: coin, grouping, mid, connection) and a visually hidden `role="status"` live region announces the same string at no more than 1 Hz — the mid moves several times a second and reading every change is unusable.

**Two defects found by looking at the surface, both fixed:** spine size labels ran off both edges at 390 px (v4 never ran narrow) — now clamped inside the canvas; the bottom sheet was translucent over the ladder and read as two overlaid books — now opaque.

**Proof** — `e2e/responsive-a11y.spec.ts`: phone at 390×844 DPR 3 reaches LIVE, collapses to the spine and paints it (pixel count down the spine column), pinch changes the grouping, the tablet drops the tape and opens the picker flush to the bottom edge, the canvas alternative and the ≤ 1 Hz announcement, hover paints and un-paints, and a keyboard-only walkthrough (Tab into the chrome, `/`, trapped Tab, Escape and focus return for both popovers, space and `v`). Suite: 144 Vitest, 16 Playwright, three consecutive clean Playwright runs to rule out flake.

**Review** — reviewer subagents still rate-limited (429), so the two-axis review was run manually against the standards skills, as on tickets 22–26.

**Gate** — signed off on the live feed: `/tmp/bp-1500.png`, `/tmp/bp-1100.png` (tape gone, trails kept), `/tmp/bp-820.png` and `/tmp/bp-820-sheet.png` (trails gone, bottom sheet), `/tmp/bp-390.png` (DPR 3, spine, LIVE), `/tmp/hover.png`.
