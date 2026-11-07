/**
 * What names the registrations a filter selects, for a deletion by filter (D-F5). A count cannot: one registration that
 * left the filter and one that joined it since the list was read leave the count where it was, and the deletion would
 * take a registration the staff member never saw. So the list names the set it shows (the digest), and the deletion has
 * to send that name back: it deletes only the set that has it. Nothing here touches the database.
 */
import { createHash } from "node:crypto";
import type { RegistrationListFilter } from "./registration-list.js";

/** A filter that sets nothing: it would select every registration of the event, which is no filter at all. */
export const isEmptyRegistrationFilter = (filter: RegistrationListFilter): boolean =>
  !filter.status && !filter.olderThan && (filter.words?.length ?? 0) === 0;

/** Not `localeCompare`: the order, and so the digest, must be the same on every server. */
function byCodeUnit(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

/**
 * The name of a set of registrations: the SHA-256 of their ids in order, one to a line, as 64 lower-case hex digits. It
 * guards against a list that went stale, not against anyone: it is no secret, and whoever may list the ids can work it out.
 */
export function registrationSelectionDigest(ids: readonly string[]): string {
  return createHash("sha256").update([...ids].sort(byCodeUnit).join("\n")).digest("hex");
}
