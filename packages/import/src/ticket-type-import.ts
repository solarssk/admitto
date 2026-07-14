import type { ImportTicketType } from "./types.js";

/** Case-insensitive match against a catalog entry's `key` OR `label` - CSV values are
 * human-typed ("VIP"/"vip"/"Vip"), not submitted through a controlled `<Select>` like the admin
 * add/edit attendee forms, so import needs the looser two-way match instead of
 * @admitto/tickets' exact-key `assertTicketTypeInCatalog`. */
export function resolveImportTicketType(
  raw: string,
  catalog: ImportTicketType[],
): ImportTicketType | null {
  const norm = raw.trim().toLowerCase();
  if (!norm) return null;
  return (
    catalog.find((t) => t.key.toLowerCase() === norm || t.label.toLowerCase() === norm) ?? null
  );
}
