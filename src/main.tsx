import { Profiler, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { FeedSource } from "./data/feed-events.types";
import { createFixtureFeed } from "./data/fixture-feed";
import { loadFixture } from "./data/fixture-loader";
import { createPrefsStore } from "./state/prefs";
import { readUrlState, writeUrlState } from "./state/widget-url";
import type { WidgetState } from "./widget/order-book";
import { OrderBook } from "./widget/order-book";
import "./widget/theme.css";

/**
 * Reading `localStorage` can throw before it is ever used: browser policy
 * turns the getter itself into a `SecurityError` in some embedding and
 * privacy modes. The prefs store already works without a backend, so the
 * failure belongs here, not in a crashed mount.
 */
function browserStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/** Widget params live in the URL (ADR 0008): `replaceState` only, foreign params preserved. */
function syncUrl(state: WidgetState): void {
  history.replaceState(null, "", writeUrlState(location.href, state));
}

function onCommit(): void {
  const commits = Reflect.get(globalThis, "__obCommits");
  if (typeof commits === "object" && commits !== null && "count" in commits && typeof commits.count === "number") {
    commits.count++;
  }
}

/**
 * Demo composition root. `?fixture=<name>` swaps the live socket for a
 * recording under `/fixtures/`; `?speed=` sets the replay multiplier.
 */
async function main(): Promise<void> {
  const root = document.getElementById("root");
  if (root === null) throw new Error("index.html must contain #root");
  const params = new URLSearchParams(location.search);
  const urlState = readUrlState(location.search);
  const coin = urlState.coin;
  const prefs = createPrefsStore(browserStorage());
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
  const tree = (
    <StrictMode>
      <Profiler id="orderbook" onRender={onCommit}>
        <OrderBook
          coin={feedCoin}
          trails={urlState.trailsOn}
          tape={urlState.tapeOn}
          overlays={urlState.overlaysOn}
          view={urlState.view}
          prefs={prefs}
          onStateChange={syncUrl}
          {...(urlState.gridTick === undefined ? {} : { gridTick: urlState.gridTick })}
          {...(feed === undefined ? {} : { feed })}
        />
      </Profiler>
    </StrictMode>
  );
  let reactRoot = createRoot(root);
  reactRoot.render(tree);
  // Demo-only: the leak proof mounts and unmounts the widget twenty times.
  Reflect.set(globalThis, "__obRemount", () => {
    reactRoot.unmount();
    reactRoot = createRoot(root);
    reactRoot.render(tree);
  });
  Reflect.set(globalThis, "__obUnmount", () => reactRoot.unmount());
}

void main();
