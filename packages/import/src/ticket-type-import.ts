import type { ImportTicketType } from "./types.js";

/** Case-insensitive match against a catalog entry's `key` OR `label` - CSV values are
 * human-typed ("VIP"/"vip"/"Vip"), not submitted through a controlled `<Select>` like the admin
 * add/edit attendee forms, so import needs the looser two-way match instead of
 * @admitto/tickets' exact-key `assertTicketTypeInCatalog`. Key matches take priority over label
 * matches (keys are unique per event, so this can never be ambiguous); a label match is only
 * accepted when exactly one catalog entry has it, since two types could share a label and a
 * catalog-order-dependent first match would silently pick the wrong one (CodeRabbit review). */
export function resolveImportTicketType(
  raw: string,
  catalog: ImportTicketType[],
): ImportTicketType | null {
  const norm = raw.trim().toLowerCase();
  if (!norm) return null;

  const keyMatch = catalog.find((t) => t.key.toLowerCase() === norm);
  if (keyMatch) return keyMatch;

  const labelMatches = catalog.filter((t) => t.label.toLowerCase() === norm);
  return labelMatches.length === 1 ? labelMatches[0]! : null;
}
