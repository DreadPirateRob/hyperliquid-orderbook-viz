import type { JSX } from "react";
import type { RefObject } from "react";
import { useCallback, useEffect, useRef } from "react";
import type { Prefs } from "../state/prefs";
import { useDismissOnOutside } from "./dismiss";
import { useFocusTrap } from "./focus-trap";
import type { ReplayControls } from "./replay.types";

/**
 * The gear popover: the settings that are preferences rather than shareable
 * state — render cadence and how far the depth ruler reaches (ADR 0008).
 */

/** Props. */
export type SettingsProps = {
  readonly prefs: Prefs;
  readonly onChange: (patch: Partial<Prefs>) => void;
  readonly onClose: () => void;
  /** Host-provided recordings; omitted when the host has none. */
  readonly replay?: ReplayControls | undefined;
  /** Dismiss without returning focus to the trigger: a pointer press outside already moved it. */
  readonly onDismiss: () => void;
  /** The trigger, excluded from outside-dismissal so its own handler decides. */
  readonly trigger: RefObject<HTMLElement | null>;
};

/** Multipliers worth offering: slow enough to read a book update, fast enough to reach a busy stretch. */
const SPEEDS: ReadonlyArray<number> = [0.5, 1, 2, 4, 8, 16];

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
  const { prefs, onChange, onClose, onDismiss, trigger, replay } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  useFocusTrap(rootRef);
  useDismissOnOutside(rootRef, onDismiss, trigger);
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
      <label data-tip="How often the canvas redraws. 60 fps is the default; 30 fps halves draw cost on a busy machine; on update draws only when the book actually changes, which idles to near zero on a quiet market.">
        <span>cadence</span>
        <select value={prefs.cadence} onChange={onCadence}>
          {CADENCES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <label data-tip="How many rows the depth ruler spans from the touch. It sets the window the cumulative figure sums over, not how many rows the ladder draws.">
        <span>ruler</span>
        <input type="range" min={4} max={40} step={1} value={prefs.ruler} onChange={onRuler} />
        <output>{prefs.ruler} rows</output>
      </label>
      {replay === undefined ? null : <ReplaySection replay={replay} />}
    </div>
  );
}

/**
 * Recording quick links, plus playback speed while one is playing.
 *
 * @param props - The host's replay controls.
 * @returns The replay section.
 */
function ReplaySection(props: { readonly replay: ReplayControls }): JSX.Element {
  const { replay } = props;
  const onSpeed = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => replay.onSpeed(Number(e.target.value)),
    [replay],
  );
  const onLive = useCallback(() => replay.onSelect(undefined), [replay]);
  return (
    <div
      className="orderbook-replay"
      role="group"
      aria-label="Replay"
      data-tip="Recorded sessions shipped with the demo. Each one is a real capture, replayed on the wall clock at its recorded spacing, so staleness and windows behave as they did live."
    >
      <span className="orderbook-replay-title">replay</span>
      <div className="orderbook-replay-list">
        <button
          type="button"
          className="orderbook-replay-option"
          aria-pressed={replay.current === undefined}
          onClick={onLive}
          data-tip="Leave replay and subscribe to the venue's live socket."
        >
          <span>live market</span>
          <span className="orderbook-replay-note">the venue socket</span>
        </button>
        {replay.options.map((o) => (
          <ReplayOptionButton key={o.name} option={o} active={o.name === replay.current} onSelect={replay.onSelect} />
        ))}
      </div>
      {replay.current === undefined ? null : (
        <label data-tip="Playback multiplier for the recording. It applies to the playback in flight: the recording does not restart and does not skip ahead.">
          <span>speed</span>
          {/* Speed applies to the recording in flight; switching it neither restarts playback nor skips. */}
          <select value={String(replay.speed)} onChange={onSpeed}>
            {SPEEDS.map((v) => (
              <option key={v} value={String(v)}>
                {v}x
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

/**
 * One recording's quick link.
 *
 * @param props - The option, whether it is playing, and the selection callback.
 * @returns The button.
 */
function ReplayOptionButton(props: {
  readonly option: ReplayControls["options"][number];
  readonly active: boolean;
  readonly onSelect: (name: string) => void;
}): JSX.Element {
  const { option, onSelect } = props;
  const onClick = useCallback(() => onSelect(option.name), [onSelect, option.name]);
  return (
    <button
      type="button"
      className="orderbook-replay-option"
      aria-pressed={props.active}
      onClick={onClick}
      data-tip={`${option.name}: ${option.label}. Replaces the feed with this recording; the coin follows the recording.`}
    >
      <span>{option.name}</span>
      <span className="orderbook-replay-note">{option.label}</span>
    </button>
  );
}

/** Parses a select's value back into the preference's domain; anything else keeps 60 fps. */
function toCadence(value: string): Prefs["cadence"] {
  return value === "30" || value === "update" ? value : "60";
}
