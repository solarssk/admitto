import type { ImportTicketType } from "./types.js";

/** Case-insensitive match against a catalog entry's `key` OR `label` - CSV values are
 * human-typed ("VIP"/"vip"/"Vip"), not submitted through a controlled `<Select>` like the admin
 * add/edit attendee forms, so import needs the looser two-way match instead of
 * @admitto/tickets' exact-key `assertTicketTypeInCatalog`. Key matches take priority over label
 * matches (keys are unique per event, so this can never be ambiguous on its own; a label match is
 * only accepted when exactly one catalog entry has it, since two types could share a label and a
 * catalog-order-dependent first match would silently pick the wrong one - CodeRabbit review).
 *
 * A key match is skipped in favor of rejecting the row outright when a *different* type's current
 * label also matches - `key` is immutable and admins only ever see/edit `label`, so a type renamed
 * away from its original label leaves a stale key lying around that can later collide with another
 * type's current, visible label (e.g. "vip" renamed to "Staff", then a new "VIP" type gets key
 * "vip_2" - importing "VIP" must not silently resolve to the renamed "Staff" type just because its
 * old key happens to still spell "vip") (Codex review). */
export function resolveImportTicketType(
  raw: string,
  catalog: ImportTicketType[],
): ImportTicketType | null {
  const norm = raw.trim().toLowerCase();
  if (!norm) return null;

  const keyMatch = catalog.find((t) => t.key.toLowerCase() === norm);
  const labelMatches = catalog.filter((t) => t.label.toLowerCase() === norm);

  if (keyMatch) {
    const collidesWithAnotherType = labelMatches.some((t) => t.key !== keyMatch.key);
    return collidesWithAnotherType ? null : keyMatch;
  }

  return labelMatches.length === 1 ? labelMatches[0]! : null;
}
