# Review

Type: task
Status: resolved
Blocked by: 28

## Question

Run the `code-review` skill against the spec and the repo's standards; resolve findings. Answer records what was found and what changed.

## Answer

**How it was run.** The two reviewer subagents were spawned once more and failed again with HTTP 429 (`retry-after` ≈ 2.9 days), so both axes were reviewed manually against `coding-standards`, `typescript-best-practices`, `react-coding-style` and the ADRs — as on tickets 22–28.

**Standards axis — findings and what changed:**

1. **Defect, fixed.** `src/data/attribution.ts`: the pending-decrease queues were consumed with `splice(0, n)` on every join and the per-price buckets were rebuilt on every expiry. Both are the same array-scan shape the burst benchmark had just punished elsewhere: a long-lived hot price copied its whole bucket per expiry. Both queues are now consumed by cursor and compacted only once mostly dead. Sustained throughput at a synthetic 100k events/s went 15,839 → 28,653 events/s and apply p99 335 µs; the published table was regenerated.
2. **Verified, no change.** The new index arithmetic: `volumeAt`'s bounds (`upperBound(from)` .. `upperBound(to) - 1`) match the window's half-open `(from, to]` semantics exactly; `prune`'s `lowerBound(cutoff)` matches the previous `rx >= t - TTL` filter; the ring-bucket modulo is negative-safe; a recycled bucket is rejected by its `id`, so a late re-attribution into a rolled-over window is correctly a no-op rather than a corruption.
3. **Verified, no change.** Layer boundaries (ADR 0003): nothing in `src/render` imports from `src/data` or `src/widget`; the painters take a `DrawContext` and a `FrameSample` and keep nothing.
4. **Verified, no change.** ADR 0008: no React state is written per frame. The end-to-end proof now asserts this by order of magnitude (≤ 3 commits against ~180 frames), because the market list and the 10 s stats refresh are legitimate chrome commits — an exact-count assertion was pinning timing, not behaviour.
5. **Verified, no change.** ADR 0005 naming: the size-delta field is never called order-flow imbalance in code, HUD, README or ADRs; `consumed`/`cancelled` and migrations are labelled heuristics wherever they surface.

**Spec axis — findings and what changed:**

1. **Verified against code, no change.** Every behaviour the README's feature guide claims: the 50 s ping (`PING_MS`, `hyperliquid-feed.ts`), the tape's 95th-percentile outlier highlight (`tape.ts` `tapeOutlier`), `prefers-reduced-motion` (`runtime.ts`), grouping's RESYNCING freeze and dim, the URL/prefs split, the breakpoint order, the ≤ 1 Hz live region.
2. **Corrected.** The README's engine-scaling paragraph and ticket 28's answer quoted the pre-review throughput figures; both now quote the regenerated numbers and name the review pass that produced them.
3. **Verified, no change.** Ticket acceptance boxes 18–28 are each backed by a test that would fail if the behaviour regressed, not by prose.

**Superseded.** The old **Types And Contracts** ticket is resolved by supersession: the seam types it asked for landed in ticket 18 (`engine-api.types.ts`, `feed-events.types.ts`, `draw.types.ts`, `frame-sample.types.ts`) and have been in use since.

**State at review end.** 150 Vitest, 17 Playwright, `tsc -b` and oxlint clean, two consecutive clean full end-to-end runs.
