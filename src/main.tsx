import { Profiler, StrictMode } from "react";
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
  if (state.overlaysOn) url.searchParams.delete("ovl");
  else url.searchParams.set("ovl", "0");
  if (state.view === "ladder") url.searchParams.delete("view");
  else url.searchParams.set("view", state.view);
  history.replaceState(null, "", url);
}

function onCommit(): void {
  const commits = Reflect.get(globalThis, "__obCommits");
  if (typeof commits === "object" && commits !== null && "count" in commits && typeof commits.count === "number") {
    commits.count++;
  }
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
  // Demo-only instrumentation: the proof surface asserts the widget does not
  // re-render at steady state, so the demo exposes React's commit count.
  const commits = { count: 0 };
  Reflect.set(globalThis, "__obCommits", commits);
  createRoot(root).render(
    <StrictMode>
      <Profiler id="orderbook" onRender={onCommit}>
        <OrderBook
          coin={feedCoin}
          trails={params.get("trails") !== "0"}
          tape={params.get("tape") !== "0"}
          overlays={params.get("ovl") !== "0"}
          view={params.get("view") === "spine" ? "spine" : "ladder"}
          onStateChange={syncUrl}
          {...(feed === undefined ? {} : { feed })}
        />
      </Profiler>
    </StrictMode>,
  );
}

void main();
