# ADR 0002: Prices are integer raw-tick counts

Status: accepted

## Context

Prices arrive as decimal strings. Float keys corrupt Map lookups and equality; the v4 prototype used floats and tolerated it only because it was throwaway. Tick size is derivable per coin: `rawTick = 10^-(D − szDecimals)`, D = 6 for perps, 8 for spot; the display grid (`sigTick`) depends on `nSigFigs`/`mantissa` and the current price decade.

## Decision

Internally a price is an **integer count of raw ticks** (branded `Tick`), parsed exactly from the wire string at the feed adapter. The grid tick is presentation: grouping, labels, and row maths derive from it at the edge. Formatting back to a decimal string happens only in the visual layer, via one price-scale record (`rawTick`, display decimals).

## Consequences

- Exact equality and Map keys; no epsilon comparisons in the engine.
- Grouping changes never touch stored prices, only the presentation grid.
- The parser must be exact (string → integer without float round-trip) and property-tested for round-tripping.
