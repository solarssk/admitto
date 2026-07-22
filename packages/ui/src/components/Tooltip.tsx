import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface TooltipProps {
  /** Tooltip text. Omit/null/empty renders children with no tooltip wiring at all - callers
   * don't need a separate conditional around this component. */
  content?: string | null;
  /** The trigger element(s), wrapped in a span for measurement. */
  children: ReactNode;
  /** Extra class name(s) for the wrapping span - e.g. to make it block/full-width in a stacked
   * list instead of the default inline-flex (matches the trigger's own natural layout). */
  className?: string;
  /**
   * "vertical" (default) grows above/below the trigger, picking whichever side has more room -
   * fine for an isolated control with open space around it (a toolbar button). "horizontal"
   * grows to the side instead, vertically centered on the trigger: viewport-edge collision
   * avoidance alone doesn't see OTHER rows in a tightly stacked list (a dropdown menu item is
   * only ~2px from its neighbors) - above/below there overlaps whichever row happens to be
   * closest regardless of which side had more viewport space. Growing sideways is immune to
   * that because neighbors sit above/below, never beside.
   */
  axis?: "vertical" | "horizontal";
}

const MARGIN = 5;
const VIEWPORT_PADDING = 8;

/**
 * Hover/focus tooltip that measures the trigger and its own rendered size at show-time and picks
 * whichever side actually has room, instead of a fixed CSS position - a static position (e.g.
 * "always above, right-aligned") reliably overlaps neighboring content in dense layouts (a
 * packed dropdown menu, a toolbar near the viewport edge). Portal-rendered into document.body so
 * it's never clipped by an ancestor's overflow and always paints above any dropdown/modal it's
 * triggered from (--z-tooltip).
 */
export function Tooltip({ content, children, className, axis = "vertical" }: Readonly<TooltipProps>) {
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [style, setStyle] = useState<CSSProperties>({ top: 0, left: 0, visibility: "hidden" });

  useLayoutEffect(() => {
    if (!visible) return;
    const trigger = wrapperRef.current;
    const bubble = bubbleRef.current;
    if (!trigger || !bubble) return;

    const triggerRect = trigger.getBoundingClientRect();
    const bubbleRect = bubble.getBoundingClientRect();

    if (axis === "horizontal") {
      const spaceLeft = triggerRect.left;
      const spaceRight = window.innerWidth - triggerRect.right;
      const fitsLeft = spaceLeft >= bubbleRect.width + MARGIN;
      const fitsRight = spaceRight >= bubbleRect.width + MARGIN;
      // Neither side actually fits (a narrow viewport where the trigger itself spans most of
      // the width, e.g. the mobile "More" menu) - horizontal has nowhere to go without spilling
      // off-screen, so fall back to vertical instead of clamping into an arbitrary position that
      // may still overlap the trigger.
      if (!fitsLeft && !fitsRight) {
        const spaceAbove = triggerRect.top;
        const spaceBelow = window.innerHeight - triggerRect.bottom;
        const placeAbove = spaceAbove >= bubbleRect.height + MARGIN || spaceAbove > spaceBelow;
        const top = placeAbove
          ? triggerRect.top - bubbleRect.height - MARGIN
          : triggerRect.bottom + MARGIN;
        let left = triggerRect.right - bubbleRect.width;
        left = Math.min(left, window.innerWidth - VIEWPORT_PADDING - bubbleRect.width);
        left = Math.max(left, VIEWPORT_PADDING);
        setStyle({ position: "fixed", top, left, visibility: "visible" });
        return;
      }

      const placeLeft = fitsLeft && (!fitsRight || spaceLeft > spaceRight);
      let left = placeLeft ? triggerRect.left - bubbleRect.width - MARGIN : triggerRect.right + MARGIN;
      left = Math.min(left, window.innerWidth - VIEWPORT_PADDING - bubbleRect.width);
      left = Math.max(left, VIEWPORT_PADDING);

      let top = triggerRect.top + triggerRect.height / 2 - bubbleRect.height / 2;
      top = Math.min(top, window.innerHeight - VIEWPORT_PADDING - bubbleRect.height);
      top = Math.max(top, VIEWPORT_PADDING);

      setStyle({ position: "fixed", top, left, visibility: "visible" });
      return;
    }

    const spaceAbove = triggerRect.top;
    const spaceBelow = window.innerHeight - triggerRect.bottom;
    const placeAbove = spaceAbove >= bubbleRect.height + MARGIN || spaceAbove > spaceBelow;
    const top = placeAbove
      ? triggerRect.top - bubbleRect.height - MARGIN
      : triggerRect.bottom + MARGIN;

    // Prefer right-aligned to the trigger's right edge (matches the old convention); flip to
    // left-aligned if that would spill past the viewport's left edge, then clamp both edges.
    let left = triggerRect.right - bubbleRect.width;
    if (left < VIEWPORT_PADDING) left = triggerRect.left;
    left = Math.min(left, window.innerWidth - VIEWPORT_PADDING - bubbleRect.width);
    left = Math.max(left, VIEWPORT_PADDING);

    setStyle({ position: "fixed", top, left, visibility: "visible" });
  }, [visible, content, axis]);

  if (!content) return <>{children}</>;

  const show = () => setVisible(true);
  const hide = () => {
    setVisible(false);
    setStyle((s) => ({ ...s, visibility: "hidden" }));
  };

  return (
    <span
      ref={wrapperRef}
      className={["at-tooltip-trigger", className].filter(Boolean).join(" ")}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {visible &&
        createPortal(
          <div ref={bubbleRef} role="tooltip" className="at-tooltip-bubble" style={style}>
            {content}
          </div>,
          document.body,
        )}
    </span>
  );
}
