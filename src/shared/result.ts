/**
 * Expected failures are values. Domain and adapter modules return a
 * `Result` whose error union is precise at the module boundary; the
 * composition root translates errors into user-visible outcomes.
 */
export type Result<T, E extends Error> =
  | { readonly _tag: "ok"; readonly value: T }
  | { readonly _tag: "err"; readonly error: E };

/**
 * Wrap a success value.
 *
 * @template T - The success type.
 * @param value - The value to wrap.
 * @returns An `ok` result.
 */
export function ok<T>(value: T): { readonly _tag: "ok"; readonly value: T } {
  return { _tag: "ok", value };
}

/**
 * Wrap an expected failure.
 *
 * @template E - The tagged error type.
 * @param error - The error to wrap.
 * @returns An `err` result.
 */
export function err<E extends Error>(error: E): { readonly _tag: "err"; readonly error: E } {
  return { _tag: "err", error };
}

/**
 * Defect helper for exhaustive union handling. Reaching it means a case was
 * added to a union without updating the switch.
 *
 * @param unexpectedCase - The value TypeScript narrowed to `never`.
 * @throws Always; this is a programming defect, not an expected failure.
 */
export function casesHandled(unexpectedCase: never): never {
  throw new Error(`Unhandled case: ${JSON.stringify(unexpectedCase)}`);
}

/**
 * Defect helper for violated internal invariants.
 *
 * @param msg - Diagnostic message.
 * @throws Always.
 */
export function shouldNeverHappen(msg?: string): never {
  throw new Error(msg ?? "Invariant violated");
}

/**
 * Defect helper for a path that is not built yet. Every call site is a
 * ticket in flight, never a shipped feature.
 *
 * @param msg - Which ticket delivers it.
 * @throws Always.
 */
export function notYetImplemented(msg?: string): never {
  throw new Error(msg ?? "Not yet implemented");
}
