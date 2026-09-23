/**
 * Replay controls an embedder may hand the widget.
 *
 * Recordings are a property of the host, not of the widget: the library knows
 * about a `FeedSource`, never about a fixture directory. An embedder that has
 * recordings passes this in and the settings panel grows a replay section;
 * without it the section does not exist and the widget is unchanged.
 */

/** One selectable recording. */
export type ReplayOption = {
  /** Identity the host uses to load it. */
  readonly name: string;
  /** What the recording demonstrates. */
  readonly label: string;
};

/** The host's replay state and the callbacks that change it. */
export type ReplayControls = {
  readonly options: ReadonlyArray<ReplayOption>;
  /** The playing recording, or `undefined` when the widget is on the live socket. */
  readonly current: string | undefined;
  /** Playback multiplier; only meaningful while a recording is playing. */
  readonly speed: number;
  /** Switch recordings, or pass `undefined` to return to the live market. */
  readonly onSelect: (name: string | undefined) => void;
  readonly onSpeed: (speed: number) => void;
};
