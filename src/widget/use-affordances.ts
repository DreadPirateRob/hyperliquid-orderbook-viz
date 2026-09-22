import type { RefObject } from "react";
import { useEffect, useState } from "react";
import type { Affordances } from "./responsive";
import { affordancesDiffer, affordancesFor } from "./responsive";

/**
 * Track the host's width as affordances, re-rendering only when a breakpoint
 * is crossed. The widget is embeddable, so the container's width decides, not
 * the viewport's.
 *
 * @param ref - The widget root.
 * @returns What the current width permits.
 */
export function useAffordances(ref: RefObject<HTMLElement | null>): Affordances {
  const [affordances, setAffordances] = useState<Affordances>(() => affordancesFor(window.innerWidth));
  useEffect(() => {
    const root = ref.current;
    if (root === null) return;
    const apply = (width: number): void => {
      const next = affordancesFor(width);
      setAffordances((prev) => (affordancesDiffer(prev, next) ? next : prev));
    };
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry !== undefined) apply(entry.contentRect.width);
    });
    observer.observe(root);
    apply(root.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, [ref]);
  return affordances;
}
