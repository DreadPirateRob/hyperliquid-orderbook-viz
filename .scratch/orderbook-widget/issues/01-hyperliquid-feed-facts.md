# Hyperliquid Feed Facts

Type: research
Status: resolved

## Question

Establish, from Hyperliquid primary sources (gitbook docs, python-sdk source, hyperliquid-dex source where public), the facts the engine depends on:
- How price precision works: relationship between `szDecimals`, max decimals (perps 6, spot 8), `nSigFigs` (allowed values, default) and `mantissa`; how to derive the tick size for a given coin + nSigFigs so prices can be integer ticks. Include worked examples for BTC, ETH, a low-priced perp, and one spot pair.
- `l2Book` semantics: level count with/without `fast`, push cadence (block time vs 0.5 s), ordering of `levels[0]`/`levels[1]` (bids vs asks), whether `time` is monotonic, behaviour when precision changes (new subscription vs same channel).
- `bbo` and `trades` semantics: fields, cadence, whether trades arrive before/after the book push that reflects them.
- Socket hygiene: heartbeat/ping requirements, idle disconnect, subscription limits, rate limits, unsubscribe message shape, testnet vs mainnet URLs.
- `meta` / `spotMeta` info endpoint: how to list coins and their `szDecimals`.
Write findings to `docs/research/hyperliquid-feed.md` with a source link per claim.

## Answer

- Findings: [Hyperliquid feed facts](../../../docs/research/hyperliquid-feed.md).
- Treat every `l2Book` payload as a full snapshot; normal subscriptions expose up to 20 levels per side and `fast` exposes five.
- In the 62.1 s mainnet observation, normal snapshots had a 5.393 s median server-time interval; `fast` had 0.538 s.
- Derive renderer ticks from `szDecimals`, price magnitude, `nSigFigs`, and mantissa; the note includes BTC, ETH, HMSTR, and HYPE/USDC worked conversions.
- `nSigFigs` accepts 2–5 or null/full precision, but omission's default and the live `mantissa: 1` HTTP 500 remain unresolved.
- Observed tuple order is bids descending then asks ascending, but no source contract labels the two arrays; source time is not a sequence number.
- `bbo` is block-change-triggered and trades are arrays; their cadence and ordering relative to book snapshots are not guaranteed.
- Send a ping before 60 s of client silence, reconnect after server disconnects, and obey the documented per-IP socket/message/subscription limits.
- Discover perp `szDecimals` through `meta`; for spot, resolve a pair's base token through `spotMeta`.
