# Tapesurf Visual Catalogue

Type: research
Status: resolved

## Question

Catalogue the visual techniques of the tapesurf.com order-book widget (https://tapesurf.com/app, free tier; a real browser session is required) so the ladder prototype can borrow from them deliberately:
- Layout: ladder geometry, where price / size / heat cell / cumulative label sit, how the spread row is drawn, round-number emphasis.
- Feel: colour palette per side, how intensity maps to size, when a cell flips to the outlier colour, depth-ruler behaviour and dimming beyond it.
- Motion: what happens to a row when a level appears / grows / shrinks / vanishes, how the depth profile animates, how the best line moves, what flashes on a trade, any easing/duration you can measure.
- Settings exposed: grouping, alignment, FPS limit, ruler distance.
Write findings to `docs/research/tapesurf-orderbook.md`, screenshots under `docs/research/tapesurf/`. Note anything we should deliberately NOT copy.

## Answer

- Live free-tier inspection selected Binance BTC/USDT in Single mode; 18 captures (including two 200 ms sequences) are in `docs/research/tapesurf/`.
- The WebGL2 ladder lays out grouped price, heat cell, exact size, horizontal block, and stepped cumulative profile around a last-trade divider.
- Ask/bid palette variables are red/amber and cyan/green; ruler-bounded local maxima drive heat brightness and block width.
- Rulers move symmetrically and rescale intensity, width, and cumulative delta; numeric ruler distance is not a settings input.
- Settings expose grouping, alignment, cross-exchange/individual scaling, item height, and 30/60/Unlimited visual FPS.
- Historical heatmap accent thresholds are distinct from the live-ladder ruler scaling; do not conflate them.
- Row lifecycle transitions, profile easing/duration, exact shader mapping, and a per-trade ladder pulse are unsourced and recorded as unresolved.
- Findings: [docs/research/tapesurf-orderbook.md](../../../docs/research/tapesurf-orderbook.md).
