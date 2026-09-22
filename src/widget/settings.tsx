import type { JSX } from "react";
import { useCallback } from "react";
import type { Prefs } from "../state/prefs";

/**
 * The gear popover: the three settings that are preferences rather than
 * shareable state — render cadence, how far the depth ruler reaches, and the
 * notional execution cost is priced at (ADR 0008).
 */

/** Props. */
export type SettingsProps = {
  readonly prefs: Prefs;
  readonly onChange: (patch: Partial<Prefs>) => void;
  readonly onClose: () => void;
};

const CADENCES: ReadonlyArray<{ readonly value: Prefs["cadence"]; readonly label: string }> = [
  { value: "60", label: "60 fps" },
  { value: "30", label: "30 fps" },
  { value: "update", label: "on update" },
];

const NOTIONALS: ReadonlyArray<{ readonly value: Prefs["notional"]; readonly label: string }> = [
  { value: 10_000, label: "$10k" },
  { value: 100_000, label: "$100k" },
  { value: 1_000_000, label: "$1M" },
];

/**
 * Render the settings popover.
 *
 * @param props - Current preferences and callbacks.
 * @returns The popover element.
 */
export function Settings(props: SettingsProps): JSX.Element {
  const { prefs, onChange, onClose } = props;
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    },
    [onClose],
  );
  const onCadence = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => onChange({ cadence: toCadence(e.target.value) }),
    [onChange],
  );
  const onNotional = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => onChange({ notional: toNotional(e.target.value) }),
    [onChange],
  );
  const onRuler = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ruler: Math.round(Number(e.target.value)) }),
    [onChange],
  );

  return (
    <div className="orderbook-gearpop" role="dialog" aria-label="Settings" onKeyDown={onKeyDown}>
      <label>
        <span>cadence</span>
        <select value={prefs.cadence} onChange={onCadence}>
          {CADENCES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>ruler</span>
        <input type="range" min={4} max={40} step={1} value={prefs.ruler} onChange={onRuler} />
        <output>{prefs.ruler} rows</output>
      </label>
      <label>
        <span>cost notional</span>
        <select value={String(prefs.notional)} onChange={onNotional}>
          {NOTIONALS.map((n) => (
            <option key={n.value} value={String(n.value)}>
              {n.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

/** Parses a select's value back into the preference's domain; anything else keeps 60 fps. */
function toCadence(value: string): Prefs["cadence"] {
  return value === "30" || value === "update" ? value : "60";
}

function toNotional(value: string): Prefs["notional"] {
  const n = Number(value);
  return n === 10_000 || n === 1_000_000 ? n : 100_000;
}
