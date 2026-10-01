import { NO_AUTOFILL_PROPS } from "../utils/no-autofill.js";

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

/** Discourage password managers from treating check-in search fields as login forms: the shared opt-out
 * (`NO_AUTOFILL_PROPS`, honoured by 1Password and LastPass) plus what makes it a search box. Bitwarden honours
 * the opt-out only for users who switched that on, so these fields' `name` and `id` must also read as a search
 * box to its own heuristics ("search" in one of them; see test/checkin/bitwardenSearchField.ts), whatever the
 * placeholder says. */
export const checkinSearchFieldAttrs = {
  ...NO_AUTOFILL_PROPS,
  role: "searchbox",
  spellCheck: false,
} as const;
