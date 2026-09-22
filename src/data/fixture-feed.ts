import { casesHandled } from "../shared/result";
import type { FeedEvent, FeedSource } from "./feed-events.types";
import type { Fixture } from "./fixture";
import { precisionOf } from "./fixture";
import { parseWireMessage } from "./wire";

/**
 * A `FeedSource` that replays a recording. Frames are scheduled at their
 * recorded spacing (divided by `speed`) and stamped with the wall clock, so
 * staleness and windows behave exactly as on a live socket. Control lines
 * drive connection events; a resubscribe replays the recorded acks and
 * pushes as they were, since only the recorded precision exists.
 */
export type FixtureFeedOptions = {
  /** Playback speed multiplier; `Infinity` delivers everything at once. */
  readonly speed: number;
};

/**
 * Build a replaying feed.
 *
 * @param fixture - The parsed recording.
 * @param options - Playback speed.
 * @returns A feed source; `select` is a no-op because the recording fixes the precision.
 */
export function createFixtureFeed(fixture: Fixture, options: FixtureFeedOptions): FeedSource {
  return {
    start: (listener) => {
      const t0 = Date.now();
      const rx0 = fixture.lines[0]?.rx ?? fixture.meta.startedAt;
      const mark = firstMid(fixture);
      const emit = (e: FeedEvent): void => listener(e);
      emit({ _tag: "market", market: { coin: fixture.meta.coin, scale: fixture.meta.scale, precision: fixture.meta.precision, mark }, rx: t0 });
      emit({ _tag: "connection", event: { _tag: "connecting" }, rx: t0 });
      emit({ _tag: "connection", event: { _tag: "open" }, rx: t0 });
      let tradesHistorical = true;
      let index = 0;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deliver = (): void => {
        timer = undefined;
        const now = Date.now();
        while (index < fixture.lines.length) {
          const line = fixture.lines[index];
          if (line === undefined) break;
          const at = t0 + (line.rx - rx0) / options.speed;
          if (at > now) {
            timer = setTimeout(deliver, at - now);
            return;
          }
          index++;
          if (line._tag === "control") {
            switch (line.control.type) {
              case "disconnect":
                emit({ _tag: "connection", event: { _tag: "closed", reason: "recorded disconnect" }, rx: at });
                break;
              case "reconnect":
                emit({ _tag: "connection", event: { _tag: "connecting" }, rx: at });
                emit({ _tag: "connection", event: { _tag: "open" }, rx: at });
                tradesHistorical = true;
                break;
              case "resubscribe":
                emit({ _tag: "market", market: { coin: fixture.meta.coin, scale: fixture.meta.scale, precision: precisionOf(line.control.to), mark }, rx: at });
                break;
              default:
                casesHandled(line.control);
            }
            continue;
          }
          const r = parseWireMessage(line.frame, { coin: fixture.meta.coin, scale: fixture.meta.scale, rx: at, tradesHistorical });
          if (r._tag === "err") {
            emit({ _tag: "connection", event: { _tag: "rejected", line: JSON.stringify(line.frame).slice(0, 200), why: r.error.message }, rx: at });
            continue;
          }
          if (r.value._tag === "ignored") continue;
          if (r.value._tag === "trades") tradesHistorical = false;
          emit(r.value);
        }
        emit({ _tag: "connection", event: { _tag: "closed", reason: "end of recording" }, rx: now });
      };
      deliver();
      return () => {
        clearTimeout(timer);
        index = fixture.lines.length;
      };
    },
    select: () => {},
  };
}

/** Mid of the first book push, in quote units; the recording's stand-in for the REST mark. */
function firstMid(fixture: Fixture): number {
  for (const line of fixture.lines) {
    if (line._tag !== "frame") continue;
    const r = parseWireMessage(line.frame, { coin: fixture.meta.coin, scale: fixture.meta.scale, rx: 0, tradesHistorical: true });
    if (r._tag !== "ok" || r.value._tag !== "l2Book") continue;
    const b = r.value.bids[0];
    const a = r.value.asks[0];
    if (b !== undefined && a !== undefined) return ((b.px + a.px) / 2) * 10 ** -fixture.meta.scale.decimals;
  }
  return 1;
}
