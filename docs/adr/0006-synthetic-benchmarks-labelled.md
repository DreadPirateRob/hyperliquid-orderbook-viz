# ADR 0006: Benchmarks: synthetic load is labelled synthetic

Status: accepted

## Context

The live feed peaks around ~30 events/s. Engine benchmarks at 1k–100k events/s say something about headroom, not about the feed.

## Decision

Benchmark inputs above live rates are generated, pre-validated events and every published number carries the label **synthetic**, framed as "N× the ~30 events/s live feed". The render benchmark replays a real recording and is labelled with its viewport/DPR emulation. `scripts/bench.ts` writes `bench/results.json` and regenerates the README table; numbers are never typed by hand.

## Consequences

- Published numbers are reproducible and honestly framed.
- CI never runs benches; they run on demand and results are committed.
