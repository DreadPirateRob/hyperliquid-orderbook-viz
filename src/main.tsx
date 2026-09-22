import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { FeedSource } from "./data/feed-events.types";
import { createFixtureFeed } from "./data/fixture-feed";
import { loadFixture } from "./data/fixture-loader";
import type { WidgetState } from "./widget/order-book";
import { OrderBook } from "./widget/order-book";
import "./widget/theme.css";

/**
 * Demo composition root. `?fixture=<name>` swaps the live socket for a
 * recording under `/fixtures/`; `?speed=` sets the replay multiplier.
 */
/** Widget params live in the URL (ADR 0008): `replaceState` only, foreign params preserved. */
function syncUrl(state: WidgetState): void {
  const url = new URL(location.href);
  if (state.trailsOn) url.searchParams.delete("trails");
  else url.searchParams.set("trails", "0");
  if (state.tapeOn) url.searchParams.delete("tape");
  else url.searchParams.set("tape", "0");
  history.replaceState(null, "", url);
}

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
      <OrderBook
        coin={feedCoin}
        trails={params.get("trails") !== "0"}
        tape={params.get("tape") !== "0"}
        onStateChange={syncUrl}
        {...(feed === undefined ? {} : { feed })}
      />
    </StrictMode>,
  );
}

void main();
