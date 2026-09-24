/**
 * `inputmode` for the check-in scan field. Hardware wedge scanners type into the focused field
 * without a keyboard, so a device with no touch input suppresses the on-screen keyboard ("none").
 * A device with any touch pointer (phone, tablet, convertible) may have no physical keyboard, so it
 * must get the keyboard ("text"). Uses `any-pointer` rather than the primary `pointer`, because a
 * tablet currently driven by a mouse or stylus reports a fine primary pointer but still has touch.
 * Not a viewport width either: a tablet is wider than the 768px "desktop" breakpoint.
 */
export function scanFieldInputMode(): "text" | "none" {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "text";
  return window.matchMedia("(any-pointer: coarse)").matches ? "text" : "none";
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
