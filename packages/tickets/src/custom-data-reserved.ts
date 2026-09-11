/** Import / attendee profile column slugs that must not be reused as custom_data source_field,
 * plus the plain-object prototype-chain keys (`__proto__`, `constructor`, `prototype`) - the
 * admin-facing slug regex (`^[a-z0-9_]+$`) happily accepts all three, and a `source_field` this
 * shape reaching a plain `{ [source_field]: value }` keyed lookup (e.g. the Attendees list's own
 * per-field filter state) resolves to the inherited prototype-chain value instead of `undefined`,
 * crashing that lookup's `?? fallback` - not exploitable against other tenants' data, but a real
 * self-inflicted crash for whichever event created the field. */
export const RESERVED_CUSTOM_DATA_SOURCE_FIELDS = [
  "first_name",
  "last_name",
  "name",
  "email",
  "ticket_type",
  "external_uuid",
  "qr_payload",
  "company",
  "department",
  "__proto__",
  "constructor",
  "prototype",
] as const;

const RESERVED_SET = new Set<string>(RESERVED_CUSTOM_DATA_SOURCE_FIELDS);

export function isReservedCustomDataSourceField(slug: string): boolean {
  return RESERVED_SET.has(slug);
}

/** Drop attribute fields that collide with fixed import/profile columns. */
export function filterCustomDataAttributeFields<T extends { source_field: string }>(
  fields: T[],
): T[] {
  return fields.filter((field) => !isReservedCustomDataSourceField(field.source_field));
}
