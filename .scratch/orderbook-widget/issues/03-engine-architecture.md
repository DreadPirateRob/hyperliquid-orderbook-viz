# Engine Architecture

Type: grilling
Status: resolved
Blocked by: 01, 16

## Question

Pin down the book engine's internals before ADRs:
- Diff algorithm across two book pushes: level identity (price tick), classification into lifecycle events (added / grew / shrank / vanished / consumed / cancelled) using trades that arrived since the previous push; handling of levels that scroll out of the 20-level window (vanished vs out-of-window).
- Persistence and resiliency bookkeeping: what state per price is retained after a level vanishes, and for how long.
- Connection state machine: transitions, staleness threshold, resubscribe/resync behaviour, what the engine emits on each transition.
- Engine API shape: input events, output (current book, lifecycle events, metrics), how presentation samples it without copying (e.g. typed arrays vs object graphs), and how the boundary would move to a Worker later.

## Answer

Evidence: live 60 s BTC run (12 slow, 110 fast, 560 bbo, 543 trades). Fast top-5 identical to slow top-5 at every shared server time (12/12). Server `time` monotonic on all streams (observed). Only 37/543 trades share a `time` with a book push. Of 599 size decreases between fast pushes, 99 (17%) had trades at that price in the window (63 fully, 36 partially explained); the rest are cancels. First `trades` batch was 9.4 s old (history). Tick derivation (`docs/research/hyperliquid-feed.md`): `sigTick` depends on price magnitude, so grids can change mid-book.

0. **Price unit**: engine stores prices as integer counts of `rawTick = 10^-(D - szDecimals)` per coin (exact for every emitted price). `sigTick(mid, nSigFigs, mantissa)` is a presentation concern computed at re-centre; engine never buckets.
1. **Storage**: per side, sorted typed arrays (`Float64Array` price ticks, `Float64Array` size, `Uint16Array` n), capacity 25. A push merges against the previous arrays in one pass; that pass is the diff. `Float64` because low-priced spot tokens overflow `Int32`.
2. **Level identity and persistence memory**: `(side, tickCount)`. Per-price history ring (first-seen, last-changed, peak size, size before last decrease, cumulative consumed/cancelled) separate from the book arrays; bounded retention after vanish (60 s horizon, 256 entries/side LRU, tunables). Reappearing levels resume their record with the gap noted.
3. **Diff and lifecycle**: events `added | grew | shrank | vanished | outOfWindow` with `{side, tick, prevSize, newSize, stream, serverTime, receivedAt}`. Every decrease splits `consumed = min(decrease, taker-side trade volume at that price with time ∈ (prevPush, thisPush])`, `cancelled = decrease − consumed`; `confidence: 'heuristic'`. Initial trades batch flagged `historical`, excluded from joins and fill markers. Fast and slow pushes both diff; BBO diffs only the best level.
4. **API**: pure module; `apply(FeedEvent)`, `snapshot(): BookView` (stable typed-array refs + `version`), `drain(): LifecycleEvent[]` (ring), `metrics()` (lazy on version). Time only via events; host sends `tick(now)` per frame. Deterministic replay.
5. **Ownership**: socket adapter owns transport (backoff reconnect, ping/50 s, subscribe bookkeeping incl. both-books precision swap, `historical` flag) and emits `connection` events; engine derives `LIVE | STALE | RESYNCING` from timestamps + `tick`.
6. **Worker seam**: all engine I/O types structured-clone-safe (typed arrays, plain records). No Worker in v1; ADR names the trigger.
