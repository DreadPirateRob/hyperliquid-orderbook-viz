# ADR 0005: Size-delta field, never called OFI

Status: accepted

## Context

True order-flow imbalance needs per-order events. This feed has none: only snapshot diffs. Publishing an "OFI" from snapshot deltas would be dishonest.

## Decision

The overlay metric is the **size-delta field**: per-price signed size changes accumulated with exponential decay (τ = 3 s), summed into a `pressure` scalar. It is named for what it is, everywhere — code, HUD, docs. Consumed-vs-cancelled attribution of decreases is a temporal trade join (600 ms grace) and is tagged `heuristic`.

## Consequences

- No claim the feed cannot back; reviewers can verify every metric against its producer.
- Renaming it OFI in any surface is a regression.
