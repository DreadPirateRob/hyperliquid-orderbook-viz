import type { RefObject } from "react";
import { useEffect } from "react";

/**
 * Close an open popover when the pointer goes down outside it.
 *
 * Both popovers are modal in effect, and a pointer press on the ladder behind
 * one reads as "I am done here" rather than as an interaction with the ladder.
 * Dismissal is deliberately separate from the owner's `onClose`: `Escape`
 * returns focus to the trigger, whereas a click has already told the browser
 * where focus belongs, and yanking it back to the trigger would fight the user.
 *
 * The trigger itself is excluded so that its own handler decides. Without that,
 * a press on the gear would dismiss here and re-open in the click handler, and
 * the popover would appear stuck open.
 */
export function useDismissOnOutside(
  ref: RefObject<HTMLElement | null>,
  onDismiss: () => void,
  trigger?: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    const onPointerDown = (e: PointerEvent): void => {
      const panel = ref.current;
      if (panel === null) return;
      const target = e.target;
      if (!(target instanceof Node)) return;
      if (panel.contains(target)) return;
      if (trigger?.current?.contains(target) === true) return;
      onDismiss();
    };
    // `pointerdown`, not `click`: a press that starts outside should dismiss
    // even if the pointer travels before release, and the canvas consumes its
    // own pointer events for the ruler.
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [ref, onDismiss, trigger]);
}
