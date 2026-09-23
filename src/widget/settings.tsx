import type { JSX } from "react";
import { useCallback, useEffect, useRef } from "react";
import type { Prefs } from "../state/prefs";
import { useFocusTrap } from "./focus-trap";

/**
 * The gear popover: the settings that are preferences rather than shareable
 * state — render cadence and how far the depth ruler reaches (ADR 0008).
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

/**
 * Render the settings popover.
 *
 * @param props - Current preferences and callbacks.
 * @returns The popover element.
 */
export function Settings(props: SettingsProps): JSX.Element {
  const { prefs, onChange, onClose } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  useFocusTrap(rootRef);
  // Opening from the gear button moves the keyboard into the panel, not past it.
  useEffect(() => {
    rootRef.current?.querySelector("select")?.focus();
  }, []);
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
  const onRuler = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ruler: Math.round(Number(e.target.value)) }),
    [onChange],
  );

  return (
    <div
      className="orderbook-gearpop"
      role="dialog"
      aria-modal="true"
      aria-label="Settings"
      ref={rootRef}
      onKeyDown={onKeyDown}
    >
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
    </div>
  );
}

/** Parses a select's value back into the preference's domain; anything else keeps 60 fps. */
function toCadence(value: string): Prefs["cadence"] {
  return value === "30" || value === "update" ? value : "60";
}
