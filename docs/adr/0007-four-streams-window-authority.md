# ADR 0007: Four streams fused by window authority

Status: accepted

## Context

One socket carries four subscriptions: slow `l2Book` (20 levels, ~5.4 s), fast `l2Book` (5 levels, ~0.54 s, `data.fast === true`), `bbo` (~70 ms), `trades`. Each covers a nested price window at a different cadence ([Feed Cadence Strategy](../../.scratch/orderbook-widget/issues/16-feed-cadence-strategy.md)).

## Decision

Fusion by **window authority**: the newest stream wins inside its own price window (bbo at the touch, fast in the top 5, slow beyond). Lifecycle events are tagged with the producing stream. Staleness: fast > 3 s or slow > 20 s → `STALE`. Precision changes unsubscribe and resubscribe **both** books with a per-stream ack gate, an on-grid check, and serialised changes; the ladder resets on the first post-ack push. The first `trades` message after subscribe is a historical backlog and is flagged, never counted.

## Consequences

- BBO flicker must be excluded from side aggregates (it authoritatively rewrites the touch many times per second).
- The adapter owns transport and acks; the engine owns `LIVE|STALE|RESYNCING` from event timestamps alone.
