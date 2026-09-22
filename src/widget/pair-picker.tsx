import type { JSX } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Star } from "lucide-react";
import type { MarketStats, MarketSummary } from "../data/hyperliquid-info";
import { useFocusTrap } from "./focus-trap";

/**
 * The pair popover: search, Perp/Spot/favourites tabs, keyboard navigation and
 * favourites. It traps focus while open and returns it to the trigger on
 * close, so the widget stays operable without a mouse.
 */

/** Which markets the list shows. */
type Tab = "perp" | "spot" | "fav";

/** Props. */
export type PairPickerProps = {
  readonly markets: ReadonlyArray<MarketSummary>;
  readonly stats: Record<string, MarketStats>;
  readonly favourites: ReadonlyArray<string>;
  readonly current: string;
  readonly onSelect: (coin: string) => void;
  readonly onToggleFavourite: (coin: string) => void;
  readonly onClose: () => void;
};

const TABS: ReadonlyArray<{ readonly id: Tab; readonly label: string }> = [
  { id: "perp", label: "Perp" },
  { id: "spot", label: "Spot" },
  { id: "fav", label: "Saved" },
];

/**
 * Render the popover.
 *
 * @param props - Markets, stats, favourites and callbacks.
 * @returns The popover element.
 */
export function PairPicker(props: PairPickerProps): JSX.Element {
  const { markets, stats, favourites, current, onSelect, onToggleFavourite, onClose } = props;
  const [tab, setTabState] = useState<Tab>(current.startsWith("@") ? "spot" : "perp");
  const [query, setQueryState] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  useFocusTrap(rootRef);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return markets.filter((m) => {
      if (tab === "fav" ? !favourites.includes(m.coin) : m.kind !== tab) return false;
      return q === "" || m.display.toLowerCase().includes(q) || m.coin.toLowerCase().includes(q);
    });
  }, [markets, favourites, tab, query]);

  // Changing tab or query restarts the cursor: both come from events, so they reset it there.
  const setTab = useCallback((next: Tab): void => {
    setTabState(next);
    setCursor(0);
  }, []);
  const setQuery = useCallback((next: string): void => {
    setQueryState(next);
    setCursor(0);
  }, []);
  const onQueryChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>): void => setQuery(e.target.value),
    [setQuery],
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setCursor((c) => Math.max(0, Math.min(visible.length - 1, c + (e.key === "ArrowDown" ? 1 : -1))));
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        const picked = visible[cursor];
        if (picked !== undefined) onSelect(picked.coin);
        return;
      }
      // Tab is left to the trap: every control in the popover is reachable.
    },
    [visible, cursor, onSelect, onClose],
  );

  useEffect(() => {
    listRef.current?.querySelector('[data-cursor="1"]')?.scrollIntoView({ block: "nearest" });
  });

  return (
    <div
      className="orderbook-pairpop"
      role="dialog"
      aria-modal="true"
      aria-label="Select market"
      ref={rootRef}
      onKeyDown={onKeyDown}
    >
      <input
        ref={inputRef}
        className="orderbook-pairsearch"
        placeholder="search markets"
        value={query}
        onChange={onQueryChange}
        aria-label="Search markets"
      />
      <div className="orderbook-pairtabs" role="tablist">
        {TABS.map((t) => (
          <TabButton key={t.id} id={t.id} label={t.label} active={t.id === tab} onSelect={setTab} />
        ))}
      </div>
      <div className="orderbook-pairlist" ref={listRef} role="listbox" aria-label="Markets">
        {visible.map((m, i) => (
          <PairRow
            key={m.coin}
            market={m}
            stats={stats[m.coin]}
            favourite={favourites.includes(m.coin)}
            selected={m.coin === current}
            cursor={i === cursor}
            onSelect={onSelect}
            onToggleFavourite={onToggleFavourite}
          />
        ))}
        {visible.length === 0 ? <p className="orderbook-pairempty">no markets match</p> : null}
      </div>
    </div>
  );
}

function TabButton(props: {
  readonly id: Tab;
  readonly label: string;
  readonly active: boolean;
  readonly onSelect: (tab: Tab) => void;
}): JSX.Element {
  const { id, onSelect } = props;
  const onClick = useCallback(() => onSelect(id), [onSelect, id]);
  return (
    <button type="button" role="tab" aria-selected={props.active} onClick={onClick}>
      {props.label}
    </button>
  );
}

function PairRow(props: {
  readonly market: MarketSummary;
  readonly stats: MarketStats | undefined;
  readonly favourite: boolean;
  readonly selected: boolean;
  readonly cursor: boolean;
  readonly onSelect: (coin: string) => void;
  readonly onToggleFavourite: (coin: string) => void;
}): JSX.Element {
  const { market, stats, onSelect, onToggleFavourite } = props;
  const onClick = useCallback(() => onSelect(market.coin), [onSelect, market.coin]);
  const onStar = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onToggleFavourite(market.coin);
    },
    [onToggleFavourite, market.coin],
  );
  const change = stats?.changePct;
  return (
    <div
      className="orderbook-pairrow"
      role="option"
      aria-selected={props.selected}
      data-cursor={props.cursor ? "1" : "0"}
      onClick={onClick}
    >
      <button
        type="button"
        className="orderbook-star"
        aria-pressed={props.favourite}
        aria-label={props.favourite ? `Unsave ${market.display}` : `Save ${market.display}`}
        onClick={onStar}
        tabIndex={-1}
      >
        <Star size={12} aria-hidden fill={props.favourite ? "currentColor" : "none"} />
      </button>
      <span className="orderbook-pairname">{market.display}</span>
      <span className="orderbook-pairpx">{stats === undefined ? "–" : formatPrice(stats.mark)}</span>
      <span className={change === undefined ? "orderbook-pairchg" : `orderbook-pairchg ${change >= 0 ? "up" : "dn"}`}>
        {change === undefined ? "–" : `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`}
      </span>
    </div>
  );
}

function formatPrice(px: number): string {
  if (px >= 1000) return px.toFixed(0);
  return px >= 1 ? px.toFixed(2) : px.toPrecision(4);
}
