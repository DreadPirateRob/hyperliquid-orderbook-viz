import { z } from "zod";

/**
 * Preferences that are not worth sharing in a URL: cadence, ruler distance,
 * metrics visibility and favourites (ADR 0008).
 * A module-level store with `subscribe`/`get` so React can read it through
 * `useSyncExternalStore` without the widget owning storage.
 */

const KEY = "ob.prefs";

const Prefs = z.object({
  cadence: z.enum(["60", "30", "update"]).default("60"),
  ruler: z.number().int().min(4).max(40).default(12),
  metricsOn: z.boolean().default(false),
  favourites: z.array(z.string()).default([]),
});

/** Stored preferences. */
export type Prefs = z.infer<typeof Prefs>;

/** Defaults used when nothing is stored or the stored value is unusable. */
export const DEFAULT_PREFS: Prefs = Prefs.parse({});

/** The store. */
export type PrefsStore = {
  /** Current value; stable identity until something changes. */
  readonly get: () => Prefs;
  /** Merge a change, persist it and notify subscribers. */
  readonly set: (patch: Partial<Prefs>) => void;
  /** Add or remove a favourite coin. */
  readonly toggleFavourite: (coin: string) => void;
  /** Subscribe to changes; returns the unsubscribe function. */
  readonly subscribe: (listener: () => void) => () => void;
};

/** Where preferences are persisted; `localStorage` in the browser. */
export type PrefsStorage = Pick<Storage, "getItem" | "setItem">;

/**
 * Create a preferences store over a storage backend. Unparseable or
 * partially-invalid stored values fall back to defaults rather than throwing,
 * because a bad preference must never stop the widget from rendering.
 *
 * @param storage - Backend to read and write; omitted disables persistence.
 * @returns The store, seeded from storage.
 */
export function createPrefsStore(storage: PrefsStorage | undefined): PrefsStore {
  let value = read(storage);
  const listeners = new Set<() => void>();
  const commit = (next: Prefs): void => {
    value = next;
    try {
      storage?.setItem(KEY, JSON.stringify(next));
    } catch {
      // Storage can be full or blocked; preferences are best-effort.
    }
    for (const listener of listeners) listener();
  };
  return {
    get: () => value,
    set: (patch) => {
      const parsed = Prefs.safeParse({ ...value, ...patch });
      commit(parsed.success ? parsed.data : value);
    },
    toggleFavourite: (coin) => {
      const has = value.favourites.includes(coin);
      commit({ ...value, favourites: has ? value.favourites.filter((c) => c !== coin) : [...value.favourites, coin] });
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function read(storage: PrefsStorage | undefined): Prefs {
  try {
    const raw = storage?.getItem(KEY);
    if (raw == null) return DEFAULT_PREFS;
    const parsed = Prefs.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}
