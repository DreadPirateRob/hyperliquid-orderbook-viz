# Record Fixtures

Type: task
Status: resolved
Blocked by: 01, 07, 16

## Question

Record live `l2Book` + `trades` + `bbo` streams to JSONL fixtures per the format from the proof-surface ticket, for the agreed coins and durations, including at least one precision change and one forced reconnect. Answer records where the files live, sizes, and message counts.

## Answer

Recorded data kept (user's call: recordings are data, not code). Eight gzipped JSONL files in `fixtures/`: header line `{"meta":{coin,nSigFigs,mantissa,szDecimals,kind,startedAt,note}}`, then `{rx,ch,data}` per raw socket message (`ch` ∈ `l2Book|bbo|trades|subscriptionResponse`), and control lines `{rx,ch:"control",data:{type,…}}` for `resubscribe`/`disconnect`/`reconnect`. Coins: BTC quiet, BTC active, ETH, HMSTR (szDecimals 0), `@107` HYPE/USDC spot, BTC precision swap, BTC reconnect, and a **synthetic** `btc-grid-change` rescaled from the quiet BTC session (note says so). The recorder script is not carried over; a new one is written if re-recording is ever needed.
