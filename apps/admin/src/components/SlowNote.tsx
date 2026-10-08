import { SLOW_NOTICE_TEXT } from "../utils/loading-timing.js";

/**
 * The line a placeholder adds after 8 seconds of waiting ("Taking longer than usual…", AGENTS.md "Admin SPA loading and busy
 * states"). Put it inside the placeholder's status region, so that assistive tech hears it too.
 */
export function SlowNote() {
  return <span className="at-hint slow-note">{SLOW_NOTICE_TEXT}</span>;
}
