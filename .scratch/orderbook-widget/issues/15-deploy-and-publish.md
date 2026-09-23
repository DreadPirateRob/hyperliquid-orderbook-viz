# Deploy And Publish

Type: task
Status: blocked
Blocked by: 14

## Question

Deploy the demo to Vercel, run the benchmark script on a recorded machine, generate the README numbers, write README (run instructions, architecture diagram, limitations, data semantics, link to ADRs). Answer records the public URL.

## Status

Blocked on account access, not on work. Everything deployable is done and pushed:

- Repo: `git@github.com:DreadPirateRob/hyperliquid-orderbook-viz.git`, branch `master`.
- `vercel.json` committed: `vite build` -> `dist`, gzip headers for `/fixtures/*.jsonl.gz`, SPA rewrite. No environment variables and no secrets are needed; the demo talks to the public Hyperliquid socket and `/info` from the browser.
- Benchmarks are generated and committed (`bench/results.json`), and the README table is regenerated from them.

To finish: import the GitHub repo at vercel.com/new (it reads `vercel.json` as-is), or supply a `VERCEL_TOKEN`. The CLI device-login route was attempted and abandoned at the user's instruction.
