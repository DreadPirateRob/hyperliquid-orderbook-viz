# Derived Metrics Definitions

Type: grilling
Status: resolved
Blocked by: 01, 03

## Question

Write the exact formula and units for each metric so the spec can state them: cumulative depth, persistence, churn (window and normalisation), imbalance (levels included), microprice, size-delta field (per push, per price, decay), resiliency (refill measure and horizon), migration pairing heuristic (size tolerance, adjacency), execution cost (VWAP + slippage for notional presets, behaviour when notional exceeds visible depth).

## Answer

Inputs: fused book (BBO best + fast top-5 + slow 20) with prices in raw ticks and sizes in coin units; lifecycle events with `consumed`/`cancelled` parts tagged by stream; history ring per price. All windows are tunables in the spec. Every metric is recomputed lazily on engine `version` change.

1. **Cumulative depth** (per side, best outward): `cum[i] = Σ size[0..i]` (coin) and `cumNtl[i] = Σ size·px` (quote). Reported per level, at the ruler row, and *within X bps of mid* (default 10 bps) both sides. Drawing normalisation = max `cum` inside the rulers.
2. **Persistence** (per price): `age = now − firstSeen` (firstSeen set on add and on return after a vanish, gap recorded); `stableFor = now − lastChanged`. Size changes do not reset `age`. Saturation ramps on `age` over 20 s.
3. **Churn** (sliding W = 5 s, per side + total, counts kept per stream): `eventChurn = (added + vanished + grew + shrank) / W` (events/s); `volumeChurn = Σ|Δsize| / W` (coin/s); `turnover = Σ|Δsize| / Σ size` (dimensionless).
4. **Imbalance / microprice**: from BBO, `share = bidSz / (bidSz + askSz)`, `imbalance = 2·share − 1`, `micro = bid + share·(ask − bid)`. N-level variant for N = 5 (fast window): `imb5 = (Σ bidSz − Σ askSz) / (Σ bidSz + Σ askSz)`. Ribbon uses TOB; HUD and the size-delta field's sign use N = 5.
5. **Size-delta field** (per price, per push): `Δ = size_new − size_old` (added = +size, vanished = −size); accumulator `F[px] ← F[px]·e^(−Δt/τ) + Δ`, τ = 3 s. `pressure = Σ F[bid] − Σ F[ask]`. Named "size-delta field" everywhere; never OFI.
6. **Trade–level interaction**: per price `consumedTotal`, `cancelledTotal`, `hitCount`, `lastHitAt`; per side over W = 60 s `consumedRate` (coin/s), `cancelRatioVol = cancelled / (consumed + cancelled)` and `cancelRatioCount = 1 − hits / decreases`. BBO-stream flicker is excluded from the per-side aggregates. Fill markers fire on trade arrival, not on the diff. **Attribution is deferred** (amended by ticket 17): a decrease stays open for a 600 ms grace window and is re-joined when later trades at that price land, so `consumed` can grow after the push. On BTC the by-volume ratio is ~100 % always; by-count is the headline.
7. **Resiliency**: watch starts when a level loses ≥ 50 % of `sizeBefore`; `refillTime = seconds until size ≥ 80 %·sizeBefore`, cap 30 s (= not refilled); `refillAt5s = size(t+5 s) / sizeBefore`. Per side: median `refillTime` over 5 min. Overlay uses refillTime; HUD shows refillAt5s.
8. **Execution cost** (notional Q ∈ {10k, 100k, 1M} quote, per side): walk from best, fill `min(remainingQ/px, size)`; `VWAP = Σ px·filled / Σ filled`; `slippageBps = |VWAP − mid| / mid · 1e4`; if the visible book is exhausted report `filledFraction = filledQ / Q` and flag `exceedsVisibleDepth`. Shown in the HUD; its widget placement is a build-time decision (ticket 17 tried two ribbon forms and dropped both).
9. **Migration** (heuristic, fast stream only): pair `vanished@p` with `added@p′` in the same push, same side, `|size − size′| ≤ 10 %`, `|p − p′| ≤ 3 grid ticks` → `migrated` event with `confidence: 'heuristic'`; trail between rows.
10. **Book shape**: sparkline = cumulative curve per side (20 points); `convexity` (amended by ticket 17) = depth within the nearest 25 % of the *visible* price span / total visible depth, per side. Fixed-bps windows were meaningless for a 20-level BTC book (~2.5 bps span).
