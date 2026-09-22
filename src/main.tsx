import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { FeedSource } from "./data/feed-events.types";
import { createFixtureFeed } from "./data/fixture-feed";
import { loadFixture } from "./data/fixture-loader";
import { OrderBook } from "./widget/order-book";
import "./widget/theme.css";

/**
 * Demo composition root. `?fixture=<name>` swaps the live socket for a
 * recording under `/fixtures/`; `?speed=` sets the replay multiplier.
 */
async function main(): Promise<void> {
  const root = document.getElementById("root");
  if (root === null) throw new Error("index.html must contain #root");
  const params = new URLSearchParams(location.search);
  const coin = params.get("coin") ?? "BTC";
  const fixtureName = params.get("fixture");
  let feed: FeedSource | undefined;
  let feedCoin = coin;
  if (fixtureName !== null) {
    const fixture = await loadFixture(`/fixtures/${fixtureName}.jsonl.gz`, globalThis.fetch.bind(globalThis));
    if (fixture._tag === "err") {
      root.textContent = `Fixture unavailable: ${fixture.error.message}`;
      return;
    }
    feed = createFixtureFeed(fixture.value, { speed: Number(params.get("speed") ?? "1") || 1 });
    feedCoin = fixture.value.meta.coin;
  }
  createRoot(root).render(
    <StrictMode>
      <OrderBook coin={feedCoin} {...(feed === undefined ? {} : { feed })} />
    </StrictMode>,
  );
}

void main();
