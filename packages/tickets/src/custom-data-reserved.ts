/** Import / attendee profile column slugs that must not be reused as custom_data source_field. */
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
