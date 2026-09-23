# ADR 0001: Snapshot-native engine, no delta synchronisation

Status: accepted

## Context

Hyperliquid's `l2Book` channel pushes **full snapshots**: ~20 levels/side every ~5.4 s, plus a 5-level `fast` variant every ~0.54 s. There are no sequence numbers, no deltas, no gap signals (observed over recorded sessions, not documented by the venue).

## Decision

The engine is snapshot-native: each push replaces the book state inside that stream's price window, and a one-pass merge against the previous state _is_ the diff that produces lifecycle events (`added|grew|shrank|vanished|outOfWindow|migrated`). There is no sequence tracking, no gap detection, no delta application, and no resynchronisation protocol beyond resubscribing.

Per the honesty rule, no mechanism exists in this codebase without a real producer in the feed. Delta-sync machinery would be dead weight defending against a failure mode this feed cannot produce.

## Consequences

- Dropped messages cost nothing: the next snapshot is authoritative.
- Lifecycle events are inferences from snapshot diffs, not order events; downstream metrics must (and do) label themselves accordingly (ADR 0005).
- If Hyperliquid ever ships a delta feed, this ADR is superseded, not amended.
