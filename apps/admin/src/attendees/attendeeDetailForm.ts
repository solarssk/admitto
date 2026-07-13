import {
  fetchAttendeeDetail,
  fetchEventCustomFields,
} from "../api/client.js";
import type { AttendeeDetailDto } from "../api/types.js";
import { formatEventDateTime } from "../utils/event-dates.js";
import {
  readCustomDataField,
  type CustomDataFieldDef,
} from "./customData.js";

export type AttendeeFormState = {
  name: string;
  email: string;
  company: string;
  department: string;
  ticket_type: string;
  customFields: Record<string, string>;
};

export const ITEMS_LOAD_WARNING =
  "Attribute fields could not be loaded — core fields are still editable.";

function customFieldsFromDetail(
  detail: AttendeeDetailDto,
  attributeFields: CustomDataFieldDef[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of attributeFields) {
    out[field.source_field] = readCustomDataField(detail.custom_data, field.source_field) ?? "";
  }
  return out;
}

export function toAttendeeForm(
  detail: AttendeeDetailDto,
  attributeFields: CustomDataFieldDef[],
): AttendeeFormState {
  return {
    name: detail.name,
    email: detail.email,
    company: detail.company ?? "",
    department: detail.department ?? "",
    ticket_type: detail.ticket_type ?? "",
    customFields: customFieldsFromDetail(detail, attributeFields),
  };
}

export function mergeFormAfterReload(
  currentForm: AttendeeFormState,
  previousDetail: AttendeeDetailDto,
  reloaded: AttendeeDetailDto,
  attributeFields: CustomDataFieldDef[],
): AttendeeFormState {
  const previousForm = toAttendeeForm(previousDetail, attributeFields);
  const nextForm = toAttendeeForm(reloaded, attributeFields);
  const customFields: Record<string, string> = { ...nextForm.customFields };
  for (const field of attributeFields) {
    const key = field.source_field;
    if (currentForm.customFields[key] !== previousForm.customFields[key]) {
      customFields[key] = currentForm.customFields[key] ?? "";
    }
  }
  return {
    name: currentForm.name !== previousForm.name ? currentForm.name : nextForm.name,
    email: currentForm.email !== previousForm.email ? currentForm.email : nextForm.email,
    company:
      currentForm.company !== previousForm.company ? currentForm.company : nextForm.company,
    department:
      currentForm.department !== previousForm.department
        ? currentForm.department
        : nextForm.department,
    ticket_type:
      currentForm.ticket_type !== previousForm.ticket_type
        ? currentForm.ticket_type
        : nextForm.ticket_type,
    customFields,
  };
}

export async function loadAttendeeDetailData(
  eventId: string,
  attendeeId: string,
): Promise<{
  detail: AttendeeDetailDto;
  attributeFields: CustomDataFieldDef[];
  itemsWarning: string | null;
}> {
  const [detail, fieldsResult] = await Promise.all([
    fetchAttendeeDetail(eventId, attendeeId),
    fetchEventCustomFields(eventId).then(
      (fields) => ({ ok: true as const, fields }),
      () => ({ ok: false as const }),
    ),
  ]);
  return {
    detail,
    attributeFields: fieldsResult.ok ? fieldsResult.fields : [],
    itemsWarning: fieldsResult.ok ? null : ITEMS_LOAD_WARNING,
  };
}

export function formatDateTime(iso: string | null, timezone?: string): string {
  if (!iso) return "—";
  return formatEventDateTime(iso, timezone);
}
