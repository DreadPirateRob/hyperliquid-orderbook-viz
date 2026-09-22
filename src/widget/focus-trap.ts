import type { RefObject } from "react";
import { useEffect } from "react";

/**
 * Keep Tab inside an open popover (spec, story 42).
 *
 * Both popovers are modal in effect: while one is open the ladder behind it is
 * not operable, so tabbing out of it strands the keyboard user on chrome that
 * does nothing. The trap cycles the popover's own focusables; `Escape` and
 * focus return stay with the owner, which knows the trigger.
 */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Trap Tab within a container while it is mounted.
 *
 * @param ref - The container; the trap is inert until it has an element.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const container = ref.current;
    if (container === null) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Tab") return;
      const items = [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      const first = items[0];
      const last = items.at(-1);
      if (first === undefined || last === undefined) return;
      const active = document.activeElement;
      const leavingBackwards = e.shiftKey && (active === first || !container.contains(active));
      const leavingForwards = !e.shiftKey && active === last;
      if (!leavingBackwards && !leavingForwards) return;
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    };
    container.addEventListener("keydown", onKey);
    return () => container.removeEventListener("keydown", onKey);
  }, [ref]);
}
