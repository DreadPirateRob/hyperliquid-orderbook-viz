# ADR 0006: Benchmarks: synthetic load is labelled synthetic

Status: accepted

## Context

The live feed peaks around ~30 events/s. Engine benchmarks at 1k–100k events/s say something about headroom, not about the feed.

## Decision

Benchmark inputs above live rates are generated, pre-validated events and every published number carries the label **synthetic**, framed as "N× the ~30 events/s live feed". The render benchmark replays a real recording and is labelled with its viewport/DPR emulation. `scripts/bench.ts` writes `bench/results.json` and regenerates the README table; numbers are never typed by hand.

## Scope of the render matrix

The proof surface originally called for 60 s per cadence x trails/tape on/off x two viewports. What is published is narrower on purpose: two viewports at the 60 fps cadence, 15 s each. Every unbenchmarked combination does strictly less work per frame — a lower cadence draws fewer frames, and a dropped column draws fewer pixels — so the published case is the expensive one, and 24 cases of mostly-redundant sampling would make a bench run a coffee break without changing any conclusion. The README states the scope alongside the numbers rather than implying the full matrix.

## Consequences

- Published numbers are reproducible and honestly framed, including what was **not** measured and what statistic is being reported.
- CI never runs benches; they run on demand and results are committed.
