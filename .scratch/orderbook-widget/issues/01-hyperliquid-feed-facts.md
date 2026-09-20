# Hyperliquid Feed Facts

Type: research
Status: open

## Question

Establish, from Hyperliquid primary sources (gitbook docs, python-sdk source, hyperliquid-dex source where public), the facts the engine depends on:
- How price precision works: relationship between `szDecimals`, max decimals (perps 6, spot 8), `nSigFigs` (allowed values, default) and `mantissa`; how to derive the tick size for a given coin + nSigFigs so prices can be integer ticks. Include worked examples for BTC, ETH, a low-priced perp, and one spot pair.
- `l2Book` semantics: level count with/without `fast`, push cadence (block time vs 0.5 s), ordering of `levels[0]`/`levels[1]` (bids vs asks), whether `time` is monotonic, behaviour when precision changes (new subscription vs same channel).
- `bbo` and `trades` semantics: fields, cadence, whether trades arrive before/after the book push that reflects them.
- Socket hygiene: heartbeat/ping requirements, idle disconnect, subscription limits, rate limits, unsubscribe message shape, testnet vs mainnet URLs.
- `meta` / `spotMeta` info endpoint: how to list coins and their `szDecimals`.
Write findings to `docs/research/hyperliquid-feed.md` with a source link per claim.
