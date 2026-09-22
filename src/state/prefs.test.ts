import { describe, expect, it, vi } from "vitest";
import { DEFAULT_PREFS, createPrefsStore } from "./prefs";
import type { PrefsStorage } from "./prefs";

function memoryStorage(seed?: string): PrefsStorage & { readonly written: () => string | undefined } {
  let value = seed;
  return {
    getItem: () => value ?? null,
    setItem: (_key, next) => {
      value = next;
    },
    written: () => value,
  };
}

describe("prefs store", () => {
  it("starts from defaults and persists changes", () => {
    const storage = memoryStorage();
    const store = createPrefsStore(storage);
    expect(store.get()).toEqual(DEFAULT_PREFS);
    store.set({ ruler: 20, cadence: "30" });
    expect(store.get().ruler).toBe(20);
    expect(JSON.parse(storage.written() ?? "{}")).toMatchObject({ ruler: 20, cadence: "30" });
    expect(createPrefsStore(storage).get().ruler, "a later session reads them back").toBe(20);
  });

  it("rejects values outside their domain instead of storing them", () => {
    const store = createPrefsStore(memoryStorage());
    store.set({ ruler: 400 });
    expect(store.get().ruler).toBe(DEFAULT_PREFS.ruler);
  });

  it("falls back to defaults for corrupt or partial storage", () => {
    expect(createPrefsStore(memoryStorage("not json")).get()).toEqual(DEFAULT_PREFS);
    expect(createPrefsStore(memoryStorage('{"ruler":"wide"}')).get()).toEqual(DEFAULT_PREFS);
    expect(createPrefsStore(memoryStorage('{"ruler":16}')).get().ruler, "missing keys take defaults").toBe(16);
  });

  it("toggles favourites and notifies subscribers once per change", () => {
    const store = createPrefsStore(memoryStorage());
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.toggleFavourite("BTC");
    expect(store.get().favourites).toEqual(["BTC"]);
    store.toggleFavourite("BTC");
    expect(store.get().favourites).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    store.set({ ruler: 8 });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("works without storage at all", () => {
    const store = createPrefsStore(undefined);
    store.set({ notional: 1_000_000 });
    expect(store.get().notional).toBe(1_000_000);
  });
});
