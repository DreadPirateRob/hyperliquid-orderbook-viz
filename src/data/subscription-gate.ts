import type { Precision } from "../domain/grouping";
import type { DepthStream } from "./feed-events.types";

/**
 * Two guards around a precision change (ADR 0007), kept out of the socket so
 * they can be tested on recordings:
 *
 * 1. **Conformance** — a push is accepted only if every price sits on the
 *    active grid. The payload proves its own precision, so in-flight pushes
 *    from the previous subscription are rejected without trusting ack order.
 * 2. **Serialisation** — a change requested while a resubscribe is pending is
 *    queued and fired once the outstanding acks land.
 */

/** What the caller must do after a `select` or an `acked`. */
export type GateAction =
  | { readonly _tag: "unchanged" }
  | { readonly _tag: "pending" }
  | { readonly _tag: "queued" }
  | { readonly _tag: "resubscribe"; readonly from: Precision; readonly to: Precision };

/** The gate. */
export type SubscriptionGate = {
  /** True when a push on `stream` at these prices belongs to the active subscription. */
  readonly accepts: (stream: DepthStream, prices: ReadonlyArray<number>) => boolean;
  /** Ask for a new precision; returns what the adapter should do. */
  readonly select: (precision: Precision, gridTick: number) => GateAction;
  /**
   * Adopt a new row step for the precision already subscribed. The same
   * `nSigFigs` means a different grid once the mid crosses a power of ten, and
   * conformance is checked against the grid, not the precision: without this a
   * book that is valid on the new grid is rejected and the ladder freezes.
   */
  readonly adoptGrid: (gridTick: number) => void;
  /** Row step currently enforced, in raw ticks. */
  readonly grid: () => number;
  /** Record an acknowledgement; returns a queued change when one is now due. */
  readonly acked: (stream: DepthStream, precision: Precision) => GateAction;
  /** Precision currently subscribed. */
  readonly active: () => Precision;
};

/**
 * Create a gate for a subscription that has been sent but not yet acked.
 *
 * @param precision - Precision the books were subscribed with.
 * @param gridTick - Row step that precision implies, in raw ticks.
 * @returns The gate, closed until acks arrive.
 */
export function createSubscriptionGate(precision: Precision, gridTick: number): SubscriptionGate {
  let active = precision;
  let grid = gridTick;
  const acked: Record<DepthStream, boolean> = { slow: false, fast: false };
  let queued: { readonly precision: Precision; readonly gridTick: number } | undefined;

  const pendingAcks = (): boolean => !acked.slow || !acked.fast;

  return {
    accepts: (stream, prices) => {
      if (!acked[stream]) return false;
      if (active._tag === "full") return true;
      for (const px of prices) if (px % grid !== 0) return false;
      return true;
    },
    select: (next, nextGrid) => {
      if (samePrecision(next, active) && queued === undefined) {
        // Same subscription, possibly a different grid: adopt it rather than
        // reporting "unchanged" and leaving the old step in force.
        grid = nextGrid;
        return { _tag: "unchanged" };
      }
      if (pendingAcks()) {
        queued = { precision: next, gridTick: nextGrid };
        return { _tag: "queued" };
      }
      const from = active;
      active = next;
      grid = nextGrid;
      acked.slow = false;
      acked.fast = false;
      return { _tag: "resubscribe", from, to: next };
    },
    acked: (stream, ackedPrecision) => {
      if (!samePrecision(ackedPrecision, active)) return { _tag: "pending" };
      acked[stream] = true;
      if (pendingAcks() || queued === undefined) return { _tag: "pending" };
      const next = queued;
      queued = undefined;
      const from = active;
      active = next.precision;
      grid = next.gridTick;
      acked.slow = false;
      acked.fast = false;
      return { _tag: "resubscribe", from, to: next.precision };
    },
    adoptGrid: (nextGrid) => {
      grid = nextGrid;
    },
    grid: () => grid,
    active: () => active,
  };
}

function samePrecision(a: Precision, b: Precision): boolean {
  if (a._tag === "full" || b._tag === "full") return a._tag === b._tag;
  return a.nSigFigs === b.nSigFigs && a.mantissa === b.mantissa;
}
