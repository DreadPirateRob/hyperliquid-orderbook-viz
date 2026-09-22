import type { PriceScale } from "../domain/tick";
import type { FrameSample } from "../state/frame-sample.types";

/** Everything a draw function needs beyond the sample: geometry and formatting. */
export type DrawContext = {
  readonly ctx: CanvasRenderingContext2D;
  /** CSS pixels; the context is already DPR-scaled. */
  readonly width: number;
  readonly height: number;
  readonly scale: PriceScale;
  /** Row step in ticks (grouping). */
  readonly gridTick: number;
  readonly trailsOn: boolean;
  readonly tapeOn: boolean;
  readonly overlaysOn: boolean;
};

/** A stateless painter: reads the sample, writes pixels, keeps nothing. */
export type Draw = (draw: DrawContext, sample: FrameSample) => void;
