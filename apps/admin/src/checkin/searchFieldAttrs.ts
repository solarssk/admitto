/**
 * `inputmode` for the check-in scan field. Hardware wedge scanners type into the focused field
 * without a keyboard, so a non-touch device suppresses the on-screen keyboard ("none"). A touch
 * device (phone, tablet) is the only place the operator can type a name or email, so it must get
 * the keyboard ("text"). Uses the primary pointer rather than a viewport width, because a tablet
 * is wider than the 768px "desktop" breakpoint but still has no physical keyboard.
 */
export function scanFieldInputMode(): "text" | "none" {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "text";
  return window.matchMedia("(pointer: coarse)").matches ? "text" : "none";
}

/** Discourage password managers from treating check-in search fields as login forms. */
export const checkinSearchFieldAttrs = {
  autoComplete: "off",
  role: "searchbox",
  spellCheck: false,
  "data-bwignore": "",
  "data-lpignore": "true",
  "data-1p-ignore": "",
  "data-form-type": "other",
} as const;
