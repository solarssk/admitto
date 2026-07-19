const SIDEBAR_PIN_KEY = "admitto_sidebar_pinned";

// The `typeof window` checks must come first: Node 25+ ships a global
// localStorage whose mere access emits an ExperimentalWarning in windowless
// test processes, so probing localStorage itself is not a safe guard. The
// try/catch handles browsers where storage access throws (Safari private
// browsing's SecurityError, storage disabled by policy).

/** Read the sidebar pin preference (defaults to pinned). */
export function readSidebarPinned(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return localStorage.getItem(SIDEBAR_PIN_KEY) !== "false";
  } catch {
    return true;
  }
}

/** Persist the sidebar pin preference — best-effort only. */
export function writeSidebarPinned(pinned: boolean): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(SIDEBAR_PIN_KEY, String(pinned));
  } catch {
    /* ignore storage errors — the toggle still works for the current page life */
  }
}
