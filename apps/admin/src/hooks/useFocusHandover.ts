import { useCallback, useEffect, useRef } from "react";

/**
 * Hands the keyboard focus on when the control that holds it is replaced by the next step of a flow: the Send button by the
 * progress, the Stop button by the result, the result's button by the form again. A browser drops the focus on `<body>` when
 * the focused control leaves the page, and the next Tab would start from the top of it.
 *
 * `step` names the step the flow is in (a change of it is the hand-over), and `target` says where the focus goes in the new
 * step; it is read after the step has been drawn. A control that is part of the flow says that it holds the focus with the
 * function this returns (its `onFocus`). Only then, and only when the focus has really fallen to the page by the time the step
 * has changed (the operator has not moved on to another control meanwhile), is it moved. Nothing else in a panel comes here:
 * a chip that is removed, or a list that closes, is not a step, and a recovery that took any control that goes away would
 * throw the focus to the top of the panel for those.
 */
export function useFocusHandover(step: string, target: () => HTMLElement | null | undefined) {
  const armedRef = useRef(false);
  const targetRef = useRef(target);
  useEffect(() => {
    targetRef.current = target;
  });
  useEffect(() => {
    const armed = armedRef.current;
    armedRef.current = false;
    if (!armed) return;
    if (document.activeElement && document.activeElement !== document.body) return;
    targetRef.current()?.focus();
  }, [step]);
  return useCallback(() => {
    armedRef.current = true;
  }, []);
}
