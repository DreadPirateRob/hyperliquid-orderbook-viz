import { Profiler, StrictMode, useCallback, useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import { createRoot } from "react-dom/client";
import type { FixtureFeed } from "./data/fixture-feed";
import { createFixtureFeed } from "./data/fixture-feed";
import type { Fixture } from "./data/fixture";
import { loadFixture } from "./data/fixture-loader";
import { createPrefsStore } from "./state/prefs";
import { readUrlState, writeUrlState } from "./state/widget-url";
import type { WidgetState } from "./widget/order-book";
import { OrderBook } from "./widget/order-book";
import type { ReplayControls } from "./widget/replay.types";
import { FIXTURES } from "./fixture-catalog";
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

const DEFAULT_SPEED = 1;

/**
 * Parsed recordings, kept by name. Decoding a recording costs a gzip pass and
 * a JSON parse per line; a remount or a switch back to one already seen must
 * not pay it again, and the parsed fixture is immutable so sharing is safe.
 */
const parsed = new Map<string, Fixture>();

/**
 * Load a recording, reusing an earlier parse.
 *
 * @param name - The recording's file name without extension.
 * @returns The fixture, or the failure to show.
 */
async function fixtureByName(name: string): Promise<{ ok: Fixture } | { error: string }> {
  const cached = parsed.get(name);
  if (cached !== undefined) return { ok: cached };
  const r = await loadFixture(`/fixtures/${name}.jsonl.gz`, globalThis.fetch.bind(globalThis));
  if (r._tag === "err") return { error: r.error.message };
  parsed.set(name, r.value);
  return { ok: r.value };
}

/** Replay selection lives in the URL beside the widget's own params. */
function writeReplayUrl(name: string | undefined, speed: number): void {
  const url = new URL(location.href);
  if (name === undefined) {
    url.searchParams.delete("fixture");
    url.searchParams.delete("speed");
  } else {
    url.searchParams.set("fixture", name);
    if (speed === DEFAULT_SPEED) url.searchParams.delete("speed");
    else url.searchParams.set("speed", String(speed));
  }
  history.replaceState(null, "", url.toString());
}

/**
 * Demo composition root. `?fixture=<name>` swaps the live socket for a
 * recording under `/fixtures/`; `?speed=` sets the replay multiplier. Both are
 * also reachable from the settings panel, which is why the demo holds them as
 * state rather than reading them once at boot.
 *
 * @param props - The initial replay selection, read from the URL.
 * @returns The demo tree.
 */
function Demo(props: {
  readonly coin: string;
  readonly fixture: string | undefined;
  readonly speed: number;
  readonly prefs: ReturnType<typeof createPrefsStore>;
  readonly initial: ReturnType<typeof readUrlState>;
}): JSX.Element {
  const [fixtureName, setFixtureName] = useState(props.fixture);
  const [speed, setSpeed] = useState(props.speed);
  const [loaded, setLoaded] = useState<{ readonly feed: FixtureFeed; readonly coin: string } | undefined>(undefined);
  const [failure, setFailure] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (fixtureName === undefined) {
      setLoaded(undefined);
      setFailure(undefined);
      return;
    }
    let cancelled = false;
    void fixtureByName(fixtureName).then((r) => {
      if (cancelled) return;
      if ("error" in r) {
        setLoaded(undefined);
        setFailure(r.error);
        return;
      }
      setFailure(undefined);
      // Speed is read here and applied live below: a recording that is already
      // playing must not restart because the user moved the multiplier.
      setLoaded({ feed: createFixtureFeed(r.ok, { speed }), coin: r.ok.meta.coin });
    });
    return () => {
      cancelled = true;
    };
    // `speed` is deliberately not a dependency: it is applied to the running
    // feed, and reloading the recording on every change would restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixtureName]);

  useEffect(() => {
    loaded?.feed.setSpeed(speed);
  }, [loaded, speed]);

  const onSelect = useCallback((name: string | undefined): void => {
    setFixtureName(name);
    setLoaded(undefined);
    setFailure(undefined);
  }, []);
  const replay = useMemo<ReplayControls>(
    () => ({ options: FIXTURES, current: fixtureName, speed, onSelect, onSpeed: setSpeed }),
    [fixtureName, speed, onSelect],
  );
  useEffect(() => writeReplayUrl(fixtureName, speed), [fixtureName, speed]);

  if (failure !== undefined) return <p className="orderbook-fixture-error">Fixture unavailable: {failure}</p>;
  // A selected recording must not mount against the live socket while it
  // loads: that would open a real subscription the user did not ask for.
  if (fixtureName !== undefined && loaded === undefined) return <p className="orderbook-fixture-error">Loading…</p>;
  const urlState = props.initial;
  return (
    <Profiler id="orderbook" onRender={onCommit}>
      <OrderBook
        coin={loaded?.coin ?? props.coin}
        trails={urlState.trailsOn}
        tape={urlState.tapeOn}
        overlays={urlState.overlaysOn}
        view={urlState.view}
        prefs={props.prefs}
        onStateChange={syncUrl}
        replay={replay}
        {...(urlState.gridTick === undefined ? {} : { gridTick: urlState.gridTick })}
        {...(loaded === undefined ? {} : { feed: loaded.feed })}
      />
    </Profiler>
  );
}

/** Mount the demo. */
function main(): void {
  const root = document.getElementById("root");
  if (root === null) throw new Error("index.html must contain #root");
  const params = new URLSearchParams(location.search);
  const urlState = readUrlState(location.search);
  const prefs = createPrefsStore(browserStorage());
  const fixtureName = params.get("fixture") ?? undefined;
  const speed = Number(params.get("speed") ?? String(DEFAULT_SPEED)) || DEFAULT_SPEED;
  // Demo-only instrumentation: the proof surface asserts the widget does not
  // re-render at steady state, so the demo exposes React's commit count.
  const commits = { count: 0 };
  Reflect.set(globalThis, "__obCommits", commits);
  const tree = (
    <StrictMode>
      <Demo coin={urlState.coin} fixture={fixtureName} speed={speed} prefs={prefs} initial={urlState} />
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

main();
