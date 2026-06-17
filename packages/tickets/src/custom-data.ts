/** Read descriptive fields from Attendee.custom_data JSON (ADR 0010). */
export type AttendeeCustomData = {
  company?: string;
  department?: string;
  shirt_size?: string;
};

export function parseCustomData(raw: unknown): AttendeeCustomData {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const o = raw as Record<string, unknown>;
  const out: AttendeeCustomData = {};
  if (typeof o.company === "string" && o.company.trim()) out.company = o.company.trim();
  if (typeof o.department === "string" && o.department.trim()) out.department = o.department.trim();
  if (typeof o.shirt_size === "string" && o.shirt_size.trim()) out.shirt_size = o.shirt_size.trim();
  return out;
}

export function shirtSizeFromCustomData(raw: unknown): string | null {
  return parseCustomData(raw).shirt_size ?? null;
}
