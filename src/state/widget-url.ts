import type { View } from "../widget/runtime";

/**
 * The widget's share link (ADR 0008): only widget params are written, foreign
 * params are preserved, and defaults are written as *absent* so a plain URL
 * stays plain. Callers apply the result with `replaceState`.
 */

/** Shareable widget state. */
export type UrlState = {
  readonly coin: string;
  readonly view: View;
  readonly trailsOn: boolean;
  readonly tapeOn: boolean;
  readonly overlaysOn: boolean;
  /** Grouping step in raw ticks; `undefined` follows the market default. */
  readonly gridTick: number | undefined;
};

/** State of a URL with no widget params. */
export const DEFAULT_URL_STATE: UrlState = {
  coin: "BTC",
  view: "ladder",
  trailsOn: true,
  tapeOn: true,
  overlaysOn: true,
  gridTick: undefined,
};

/**
 * Read widget state from a URL's query string.
 *
 * @param search - The query string, with or without `?`.
 * @returns State, with defaults for anything absent or unusable.
 */
export function readUrlState(search: string): UrlState {
  const p = new URLSearchParams(search);
  const g = Number(p.get("g"));
  return {
    coin: p.get("coin") ?? DEFAULT_URL_STATE.coin,
    view: p.get("view") === "spine" ? "spine" : "ladder",
    trailsOn: p.get("trails") !== "0",
    tapeOn: p.get("tape") !== "0",
    overlaysOn: p.get("ovl") !== "0",
    gridTick: Number.isSafeInteger(g) && g > 0 ? g : undefined,
  };
}

/**
 * Write widget state into a URL, leaving every other param untouched.
 *
 * @param href - The current absolute URL.
 * @param state - State to encode.
 * @returns The new absolute URL.
 */
export function writeUrlState(href: string, state: UrlState): string {
  const url = new URL(href);
  const set = (key: string, value: string | undefined): void => {
    if (value === undefined) url.searchParams.delete(key);
    else url.searchParams.set(key, value);
  };
  set("coin", state.coin === DEFAULT_URL_STATE.coin ? undefined : state.coin);
  set("view", state.view === "ladder" ? undefined : state.view);
  set("trails", state.trailsOn ? undefined : "0");
  set("tape", state.tapeOn ? undefined : "0");
  set("ovl", state.overlaysOn ? undefined : "0");
  set("g", state.gridTick === undefined ? undefined : String(state.gridTick));
  return url.toString();
}
