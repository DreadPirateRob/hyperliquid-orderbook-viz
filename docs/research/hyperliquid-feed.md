# Hyperliquid feed facts

**Scope.** This note answers the order-book engine questions against Hyperliquid's public documentation, first-party Python SDK, and a direct mainnet WebSocket observation on 2026-09-20. “Observed—not-documented” facts describe that single run, not a protocol guarantee.

## Executive decisions

1. Treat each `l2Book` payload as a **complete snapshot**, never as a delta. The documented slow form has up to 20 levels per side; `fast: true` has only five. [Hyperliquid WebSocket subscriptions](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions.md)
2. Use a decimal/rational integer-tick representation whose tick is recalculated when price magnitude or `nSigFigs` changes; do not use binary floating point.
3. Subscribe to `l2Book` with `fast: true` only if five levels are sufficient. In the direct run it was approximately 2 Hz; the 20-level subscription was approximately one snapshot per 5.4 s, not 2 Hz.
4. When changing precision, unsubscribe the old `l2Book` subscription, then subscribe with the new object and discard state until its first complete snapshot. Two precision subscriptions for one coin can emit indistinguishable messages on the same channel.
5. Use `time` as an opaque source timestamp for display/correlation, not as a globally monotonic sequence or an ordering proof. The protocol publishes neither sequence numbers nor cross-channel ordering.

## Price and size precision

### Documented contract

- `szDecimals` is the asset's size precision: a size has at most that many decimal places. Perpetual prices are limited to five significant figures and no more than `6 - szDecimals` decimal places; spot uses `8 - szDecimals`. Integer prices remain valid even when they exceed five significant figures. [Tick and lot size](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/tick-and-lot-size.md)
- For the `l2Book` aggregation parameter, `nSigFigs` may be `2`, `3`, `4`, `5`, or `null`; `null` means full precision. `mantissa` is allowed only with `nSigFigs: 5`, and its documented values are `1`, `2`, and `5`. [L2 book snapshot request schema](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint.md#l2-book-snapshot)
- The documentation calls both parameters optional but does **not** state the default when they are omitted. The official SDK's `l2_snapshot()` likewise sends only `{type: "l2Book", coin}` and exposes no aggregation arguments. [SDK `Info.l2_snapshot`](https://github.com/hyperliquid-dex/hyperliquid-python-sdk/blob/master/hyperliquid/info.py#L447-L472)

### Tick derivation for the renderer

This is a **derived renderer formula**, not a formula published by Hyperliquid. It combines the documented decimal floor with the documented significant-figure aggregation; direct samples below confirm the resulting grids.

Let:

- `D = 6` for perps and `D = 8` for spot;
- `s = szDecimals` for a perp, or the base token's `szDecimals` for a spot pair;
- `P > 0` be the price magnitude currently being represented;
- `N ∈ {2, 3, 4, 5}` be `nSigFigs`; and
- `m ∈ {1, 2, 5}` be the mantissa, with omitted mantissa treated as the base (`m = 1`) for the formula.

The full-precision price increment is:

$$
\operatorname{rawTick}=10^{-(D-s)}.
$$

For an aggregated book, use:

$$
\operatorname{sigTick}(P,N)=\max\left(10^{-(D-s)},\;10^{\lfloor\log_{10}P\rfloor-N+1}\right),
\qquad
\operatorname{tick}(P,N,m)=m\,\operatorname{sigTick}(P,N).
$$

For `nSigFigs: null`, use `rawTick`; prices are then converted without rounding to an integer tick count using exact decimal arithmetic: `tickCount = price / tick`. The `max` is essential: aggregation must not claim resolution finer than the exchange's permitted decimal resolution. The underlying limits come from [Tick and lot size](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/tick-and-lot-size.md); the aggregation modes come from the [L2 request schema](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint.md#l2-book-snapshot).

| Live example, `N = 5`, `m` omitted | Calculation | Tick and exact integer conversion |
| --- | --- | --- |
| **BTC perp** (`s=5`, `P=81,174.0`) | `rawTick=10^-(6-5)=0.1`; `sigTick=10^(4-5+1)=1`; max = `1` | `1`; `81,174.0 / 1 = 81,174` ticks. |
| **ETH perp** (`s=4`, `P=2,624.4`) | `rawTick=10^-(6-4)=0.01`; `sigTick=10^(3-5+1)=0.1`; max = `0.1` | `0.1`; `2,624.4 / 0.1 = 26,244` ticks. |
| **HMSTR perp** (`s=0`, `P=0.000167`) | `rawTick=10^-(6-0)=0.000001`; `sigTick=10^(-4-5+1)=0.00000001`; max = `0.000001` | `0.000001`; `0.000167 / 0.000001 = 167` ticks. |
| **HYPE/USDC spot** (`@107`, base HYPE `s=2`, `P=92.446`) | `rawTick=10^-(8-2)=0.000001`; `sigTick=10^(1-5+1)=0.001`; max = `0.001` | `0.001`; `92.446 / 0.001 = 92,446` ticks. |

The live `meta` and `spotMeta` responses supplied the four `szDecimals` values, and the live `l2Book` requests supplied the prices. Perp `meta` exposes `universe[].name` and `universe[].szDecimals`; spot `spotMeta` exposes `universe[].tokens` and `tokens[].szDecimals`. [Perpetual metadata](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals.md#retrieve-perpetuals-metadata-universe-and-margin-tables) · [Spot metadata](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/spot.md#retrieve-spot-metadata)

**Observed—not-documented (2026-09-20).** A same-block HTTP sample produced the four grids above: BTC `$1`, ETH `$0.10`, HMSTR `$0.000001`, and HYPE `$0.001`. BTC with `mantissa: 2` produced `$2` grid prices (`81174`, `81172`, …); with `mantissa: 5` it produced `$5` grid prices (`81170`, `81165`, …). Omitting both aggregation fields exactly matched an explicit `nSigFigs: null` response for one shared BTC snapshot, which is evidence—not a documented promise—that omission currently means full precision. Contrary to the documented accepted values, the live HTTP request `{nSigFigs: 5, mantissa: 1}` returned HTTP 500 with a null body; use an omitted mantissa for the base grid until Hyperliquid clarifies this.

## `l2Book` semantics

### Message shape, levels, and cadence

Subscribe with:

```json
{ "method": "subscribe", "subscription": { "type": "l2Book", "coin": "BTC" } }
```

The optional fields are `nSigFigs`, `mantissa`, and `fast`; the documented result is `WsBook { coin, levels: [WsLevel[], WsLevel[]], time }`, where a level is `{ px: string, sz: string, n: number }`. Hyperliquid labels this a “Snapshot feed,” pushed on each block that is at least 0.5 s after the prior push. [Subscriptions and TypeScript definitions](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions.md)

- Without `fast`, a snapshot has up to **20 levels per side**. With `fast: true`, it has **five levels per side**. [Subscription options](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions.md)
- The protocol's price-time-priority matching book requires orders to be integer multiples of tick and lot size, but it does not publish the individual orders through `l2Book`; `n` is the number of orders aggregated at that price. [HyperCore order book](https://hyperliquid.gitbook.io/hyperliquid-docs/hypercore/order-book.md) · [WebSocket `WsLevel`](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions.md)
- The documentation gives `time: number`, but it makes no monotonicity, uniqueness, epoch-unit, or cross-channel-ordering guarantee. [WebSocket `WsBook`](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions.md)

**Observed—not-documented (62.113 s, BTC and HMSTR, mainnet).** Normal subscriptions each delivered 13 snapshots with median adjacent server-time interval **5,393 ms** (minimum 550 ms, maximum 5,554 ms), and 20 levels on both sides. `fast: true` each delivered 114 snapshots with median **538 ms** (BTC min/max 457/616 ms; HMSTR 457/616 ms), and five levels on both sides. In this run every adjacent `l2Book.time` increased, but that is not a protocol guarantee. This directly contradicts an assumption that the 20-level feed is a guaranteed 2 Hz feed.

### Side ordering and precision changes

The public docs and SDK type the two `levels` arrays but do not label their positions as bids or asks. The observed BTC snapshot began `levels[0] = 81035.0, 81034.0, …` and `levels[1] = 81036.0, 81037.0, …`; HMSTR similarly had the lower, descending side first. Therefore `levels[0]` behaves as **bids in descending price order** and `levels[1]` as **asks in ascending price order** in the live product. [Documented tuple shape](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions.md) **This is observed convention, not a written contract; assert it when accepting a snapshot.**

A precision change is a different subscription object, not a mutation message. The SDK sends a subscription object with `method: "subscribe"`; it removes the same object with `method: "unsubscribe"` once its final local consumer is gone. [SDK subscribe/unsubscribe implementation](https://github.com/hyperliquid-dex/hyperliquid-python-sdk/blob/master/hyperliquid/websocket_manager.py#L123-L164)

**Observed—not-documented.** Subscribing to BTC at `nSigFigs: 5`, then sending a second subscription with `nSigFigs: 5, mantissa: 5` on the same socket created concurrent feeds. At identical server `time` values the client received both `$1` prices (`81188`/`81189`) and `$5` prices (`81185`/`81190`), but each message was only `channel: "l2Book"` plus `WsBook` data—no precision discriminator. The safe cutover is therefore: unsubscribe the old exact object, subscribe the new exact object, then accept the first new snapshot. Do not run two l2 precisions for one coin on one socket.

## BBO and trades

### Documented fields and push rule

- `bbo` is subscribed as `{type: "bbo", coin}` and returns `WsBbo { coin, time, bbo: [WsLevel | null, WsLevel | null] }`. It is sent only if BBO changes on a block. [BBO subscription and type](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions.md)
- `trades` is subscribed as `{type: "trades", coin}` and returns a `WsTrade[]` array. Each trade has `coin`, `side`, `px`, `sz`, `hash`, `time`, `tid`, and `users: [buyer, seller]`. `tid` is a 50-bit hash of buyer and seller OIDs; the docs prescribe `(block_time, coin, tid)` for a globally unique trade identity. [Trade subscription and type](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions.md)
- The docs specify neither a trade push interval nor a relation between a trade message and a particular book push. BBO's “only if changed on a block” is a conditional rule, not a guaranteed interval. [Subscriptions](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions.md)

**Observed—not-documented (62.113 s, BTC).** The BTC socket delivered 635 BBO messages (median server-time interval 71 ms), 159 trade-array messages containing 1,372 trades (median client-arrival interval 291 ms), and 13 normal book snapshots. The initial BTC trade delivery contained trades roughly 10 seconds older than receipt; the low-priced HMSTR initial delivery contained 30 historical trades, with its first timestamp about 2.1 hours older than receipt. Initial trade data should therefore be treated as a potential historical batch, not assumed live-only.

### Trade-to-book ordering

No source guarantees that a trade arrives before or after the snapshot that reflects it. A complete book snapshot contains aggregates, not per-order removals, so a client cannot prove from these feeds that a particular size reduction was caused by a particular trade. In the direct run, BBO, trade arrays, and book snapshots interleaved, but that observation cannot establish causal ordering. The engine must classify “consumed versus cancelled” as a same/adjacent-snapshot heuristic and keep it explicitly synthetic.

## Socket hygiene and limits

- Mainnet is `wss://api.hyperliquid.xyz/ws`; testnet is `wss://api.hyperliquid-testnet.xyz/ws`. The official SDK maps the matching HTTPS base URLs to `/ws`. [WebSocket URLs](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket.md) · [SDK base URLs](https://github.com/hyperliquid-dex/hyperliquid-python-sdk/blob/master/hyperliquid/utils/constants.py)
- The server closes a connection that has not sent it a message in 60 seconds. For quiet subscriptions, send `{ "method": "ping" }`; the response is `{ "channel": "pong" }`. The SDK conservatively sends one every 50 seconds. [Heartbeats](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/timeouts-and-heartbeats.md) · [SDK ping loop](https://github.com/hyperliquid-dex/hyperliquid-python-sdk/blob/master/hyperliquid/websocket_manager.py#L70-L87)
- API-server disconnects can occur periodically and without notice; reconnect gracefully and wait for fresh subscription data. [WebSocket reconnect guidance](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket.md)
- Per IP: maximum 10 concurrent WebSockets, 30 new WebSockets/minute, 1,000 subscriptions, 2,000 outbound messages/minute, and 100 simultaneous post requests. [Rate limits](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/rate-limits-and-user-limits.md)
- Unsubscribe with the same subscription object: `{ "method": "unsubscribe", "subscription": { "type": "l2Book", "coin": "BTC" } }`. The public SDK emits that shape only when the last callback for its identifier is removed. [SDK unsubscribe](https://github.com/hyperliquid-dex/hyperliquid-python-sdk/blob/master/hyperliquid/websocket_manager.py#L151-L164)

## Discovering the market universe

For perps, `POST /info` with `{ "type": "meta" }` returns `universe[]`; use each item's `name` as the coin and its `szDecimals` for size and tick calculations. `metaAndAssetCtxs` returns the same metadata paired by index with current contexts. [Perpetual metadata endpoint](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals.md#retrieve-perpetuals-metadata-universe-and-margin-tables) · [Meta plus contexts](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals.md#retrieve-perpetuals-asset-contexts-includes-mark-price-current-funding-open-interest-etc)

For spot, `POST /info` with `{ "type": "spotMeta" }` returns a `tokens[]` table and a `universe[]` pair table. Resolve a pair's `tokens: [baseIndex, quoteIndex]`, then use `tokens[baseIndex].szDecimals`; the official SDK does exactly this when building `asset_to_sz_decimals`. [Spot metadata endpoint](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/spot.md#retrieve-spot-metadata) · [SDK spot mapping](https://github.com/hyperliquid-dex/hyperliquid-python-sdk/blob/master/hyperliquid/info.py#L31-L49)

Socket/info coin names are not uniformly UI pair labels: perps use their `meta` name; spot uses `PURR/USDC` for PURR and `@{spot-universe-index}` for other spot markets. The docs specifically warn that UI names can be remapped—for example UI BTC/USDC maps to HyperCore UBTC/USDC. [Perps versus spot coin identifiers](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint.md#perpetuals-vs-spot)

## Changelog check

The official docs sitemap has no API changelog entry, and the current `/changelog.md` URL returns “Page Not Found.” [Official sitemap](https://hyperliquid.gitbook.io/hyperliquid-docs/sitemap.md) · [Changelog URL result](https://hyperliquid.gitbook.io/hyperliquid-docs/changelog.md) The first-party SDK does publish [GitHub Releases](https://github.com/hyperliquid-dex/hyperliquid-python-sdk/releases), but those releases are SDK release notes rather than a protocol/API change log. No authoritative change notice for the feed semantics above was found.

## Unresolved

1. **Documented default aggregation:** Hyperliquid documents allowed `nSigFigs` values and that `null` is full precision, but not the default for omitted `nSigFigs`/`mantissa`. Omission matched `null` in one observation only; do not make it a contract.
2. **`mantissa: 1` discrepancy:** Docs say it is allowed, while the live HTTP request returned HTTP 500. Whether that is transient, intentional, or a server bug is not documented.
3. **Tuple-side guarantee:** Live books behave as `[bids desc, asks asc]`, but neither the WebSocket documentation nor the first-party SDK labels the two `levels` arrays. There is no written compatibility guarantee.
4. **Timestamp guarantee:** No source specifies whether `time` is Unix milliseconds, monotonic, unique, or globally comparable between `l2Book`, `bbo`, and `trades`.
5. **Cross-channel ordering:** No source says whether trade arrays precede or follow the book/BBO state that reflects them. Snapshot aggregation makes an observational proof impossible.
6. **Guaranteed cadence:** The docs describe a 0.5 s lower bound for snapshot pushes but no exact cadence by `fast` mode. The 5.4 s normal / 0.538 s fast measurements are one observation, not SLAs.
