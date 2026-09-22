# ADR 0008: React owns the chrome, through five fixed seams

Status: accepted

## Context

Decided q-by-q with the user during the first build attempt; the decisions survive the attempt (the failure was the visual layer, not these seams). v4's DOM chrome maps 1:1 onto them.

## Decision

1. **Runtime as external object**: React calls `runtime.update(state)` in an effect on state change; the runtime diffs (coin → feed restart + engine reset; grouping → `setPrecision` + reset; pause → stop ticking) and the frame loop reads its own copy. No React reads per frame.
2. **Prefs**: module-singleton localStorage store; React subscribes via `useSyncExternalStore`; the loop reads it directly.
3. **URL**: `history.replaceState` only, widget-owned params only (`coin, view, trails, tape, ovl, g`); foreign params preserved; no popstate handling.
4. **Props seed initial state only** (URL wins); `onStateChange` reports. Not a controlled component.
5. **High-frequency text (HUD, top-bar mid/connection) is written by ref** from the runtime's 2 Hz telemetry tick; zero React commits at steady state. Live region ≤ 1 Hz.

Amendment from the retrospective: there is **no tooltip** (v4 has none); pointer position feeds a hover-row highlight drawn on canvas. Zustand/Jotai remain rejected: one reducer + one external store cover the need.

## Consequences

- Canvas mounts once; strict-mode-safe symmetric cleanup is mandatory and tested (mount/unmount cycles leak nothing).
- Chrome re-renders only on user action or 10 s REST refresh.
