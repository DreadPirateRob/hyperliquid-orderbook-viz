import { z } from "zod";
import type { Precision } from "../domain/grouping";
import type { MarketKind, PriceScale } from "../domain/tick";
import * as Tick from "../domain/tick";
import type { Result } from "../shared/result";
import { err, ok } from "../shared/result";

/**
 * The recording format in `fixtures/*.jsonl`: one header line
 * `{"meta":{…}}`, then `{rx, ch, data}` frames as received from the socket,
 * plus `ch:"control"` lines marking what the recorder did.
 */

const Meta = z.object({
  coin: z.string(),
  nSigFigs: z.number().int().nullable(),
  mantissa: z.number().int().nullable(),
  szDecimals: z.number().int(),
  kind: z.enum(["perp", "spot"]),
  startedAt: z.number(),
  note: z.string(),
});
const Header = z.object({ meta: Meta });
const PrecisionLine = z.object({ nSigFigs: z.number().int().nullable(), mantissa: z.number().int().nullable() });
const Control = z.discriminatedUnion("type", [
  z.object({ type: z.literal("resubscribe"), from: PrecisionLine, to: PrecisionLine }),
  z.object({ type: z.literal("disconnect") }),
  z.object({ type: z.literal("reconnect") }),
]);
const Frame = z.object({ rx: z.number(), ch: z.string(), data: z.unknown() });

/** What the recorder wrote about the session. */
export type FixtureMeta = {
  readonly coin: string;
  readonly kind: MarketKind;
  readonly scale: PriceScale;
  readonly precision: Precision;
  readonly startedAt: number;
  readonly note: string;
  /** True when the note marks the recording as synthetic (ADR 0006). */
  readonly synthetic: boolean;
};

/** One line after the header. */
export type FixtureLine =
  | { readonly _tag: "frame"; readonly rx: number; readonly frame: unknown }
  | { readonly _tag: "control"; readonly rx: number; readonly control: z.infer<typeof Control> };

/** A parsed recording. */
export type Fixture = {
  readonly meta: FixtureMeta;
  readonly lines: ReadonlyArray<FixtureLine>;
};

/** The recording's header or a line does not match the format. */
export class MalformedFixture extends Error {
  readonly _tag = "MalformedFixture" as const;

  constructor(
    readonly line: number,
    readonly why: string,
  ) {
    super(`Fixture line ${line}: ${why}`);
  }
}

/**
 * Convert a recorded precision line into the domain type.
 *
 * @param p - `{nSigFigs, mantissa}` with nulls as recorded.
 * @returns The precision.
 */
export function precisionOf(p: { readonly nSigFigs: number | null; readonly mantissa: number | null }): Precision {
  return p.nSigFigs === null ? { _tag: "full" } : { _tag: "aggregated", nSigFigs: p.nSigFigs, mantissa: p.mantissa ?? undefined };
}

/**
 * Parse a whole recording from its decoded text.
 *
 * @param text - The `.jsonl` content.
 * @returns The fixture, or `MalformedFixture` naming the offending line.
 */
export function parseFixture(text: string): Result<Fixture, MalformedFixture | Tick.InvalidScale> {
  const rows = text.split("\n").filter((l) => l.length > 0);
  const head = rows[0];
  if (head === undefined) return err(new MalformedFixture(1, "empty"));
  const header = Header.safeParse(json(head));
  if (!header.success) return err(new MalformedFixture(1, z.prettifyError(header.error)));
  const m = header.data.meta;
  const scale = Tick.makeScale(m.kind, m.szDecimals);
  if (scale._tag === "err") return scale;
  const lines: FixtureLine[] = [];
  for (let i = 1; i < rows.length; i++) {
    const frame = Frame.safeParse(json(rows[i] ?? ""));
    if (!frame.success) return err(new MalformedFixture(i + 1, z.prettifyError(frame.error)));
    if (frame.data.ch === "control") {
      const control = Control.safeParse(frame.data.data);
      if (!control.success) return err(new MalformedFixture(i + 1, z.prettifyError(control.error)));
      lines.push({ _tag: "control", rx: frame.data.rx, control: control.data });
    } else {
      lines.push({ _tag: "frame", rx: frame.data.rx, frame: { channel: frame.data.ch, data: frame.data.data } });
    }
  }
  return ok({
    meta: {
      coin: m.coin,
      kind: m.kind,
      scale: scale.value,
      precision: precisionOf(m),
      startedAt: m.startedAt,
      note: m.note,
      synthetic: m.note.startsWith("SYNTHETIC"),
    },
    lines,
  });
}

function json(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}
