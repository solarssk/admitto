import { ApiError } from "./client.js";

const MACHINE_CODE = /^[a-z][a-z0-9_]*$/;

/** Known API error codes and operator-safe literals mapped to UI copy. */
const CODE_MESSAGES: Record<string, string> = {
  already_assigned: "This role assignment already exists.",
  already_enrolled: "Two-factor authentication is already enabled.",
  authentication_required: "Your session has expired. Sign in again.",
  body_required: "Request body is required.",
  cannot_deactivate_self: "You cannot deactivate your own account.",
  cannot_revoke_current: "You cannot revoke your current session.",
  cannot_revoke_own_session: "You cannot revoke your current session.",
  conflicting_custom_data_field_options: "Conflicting custom field options.",
  default_item_not_deletable: "This default item cannot be deleted.",
  delivery_not_created: "Could not create the delivery.",
  delivery_not_found: "Delivery not found.",
  duplicate_issuer: "An identity provider with this issuer already exists.",
  email_conflict: "That email is already in use.",
  email_taken: "A user with this email already exists.",
  empty_file: "The file is empty.",
  event_archived: "This event is archived.",
  event_full: "Event is at capacity.",
  export_too_large: "Export is too large. Narrow filters or export in parts.",
  forbidden: "You do not have access.",
  invalid_code: "Invalid authenticator code.",
  invalid_json: "Invalid request.",
  instance_url_required:
    "Set the Instance URL in Settings → General before sending ticket emails.",
  "invalid file content": "The file could not be read. Check that it is a valid CSV or XLSX.",
  item_in_use: "This item is in use and cannot be changed.",
  last_superadmin: "Cannot remove or deactivate the last superadmin.",
  managed_by_idp: "This role is managed by an identity provider and cannot be removed.",
  manual_lookup_disabled: "Manual lookup is disabled for this event — use QR scan only.",
  mappings_required: "Role mappings are required before enabling this provider.",
  no_local_password: "Password is managed by your identity provider.",
  not_found: "The requested item was not found.",
  required_custom_data_field_missing: "A required custom field is missing.",
  resend_skipped: "Ticket email was not sent.",
  save_failed: "Save failed. Try again.",
  "server error": "Something went wrong. Try again.",
  setup_not_ready: "Complete the setup steps before finishing.",
  stale_write: "Someone else changed this record. Reload and try again.",
  template_in_use: "This template already has deliveries and cannot be deleted.",
  template_limit_reached: "Template limit reached for this event.",
  template_name_conflict: "A template with this name already exists.",
  template_not_found: "Template not found.",
  template_required: "Ticket template cannot be deleted.",
  template_validation_failed: "Fix template validation errors and try again.",
  toggle_race: "Provider state changed. Reload and try again.",
  too_many_attendees: "Too many attendees selected.",
  too_many_rows: "File exceeds the 50 000 row limit. Split the file and import in parts.",
  too_many_streams: "Too many live connections. Try again shortly.",
  unauthorized: "Your session has expired. Sign in again.",
  unknown_custom_data_field: "Unknown custom field.",
  unsupported_file_type: "Unsupported file type. Upload a PNG, JPG, or WebP image.",
  "unsupported file type": "Unsupported file type. Upload a .csv or .xlsx file.",
  validation_failed: "Check the form and try again.",
  wrong_password: "Current password is incorrect.",
  "file too large": "File exceeds the 5 MB limit. Split the file and import in parts.",
};

/** Longest keys first so substring fallback prefers specific codes over shorter ones. */
const CODE_MESSAGE_ENTRIES = Object.entries(CODE_MESSAGES).sort((a, b) => b[0].length - a[0].length);

function normalizedCode(err: ApiError): string | undefined {
  const fromField = err.code?.trim();
  if (fromField) return fromField;
  const fromMessage = err.message.trim();
  if (fromMessage && MACHINE_CODE.test(fromMessage)) return fromMessage;
  return undefined;
}

/** Machine-readable API error code when present. */
export function apiErrorCode(err: unknown): string | undefined {
  return err instanceof ApiError ? normalizedCode(err) : undefined;
}

/** Whether an API failure matches a known machine-readable code. */
export function hasApiErrorCode(err: unknown, code: string): boolean {
  if (!(err instanceof ApiError)) return false;
  const needle = code.trim();
  if (!needle) return false;
  return normalizedCode(err) === needle;
}

function messageForKnownCode(err: ApiError): string | undefined {
  const code = normalizedCode(err);
  if (code && CODE_MESSAGES[code]) return CODE_MESSAGES[code];

  for (const [key, copy] of CODE_MESSAGE_ENTRIES) {
    if (err.message.includes(key)) return copy;
  }
  return undefined;
}

function isOperatorSafeDetail(detail: string): boolean {
  if (detail.length > 200) return false;
  if (/at\s+\S+\s+\(/.test(detail)) return false;
  if (/at\s+[^\s]+\s*:\d+/.test(detail)) return false;
  if (/[/\\](?:src|node_modules|packages|apps)[/\\]/.test(detail)) return false;
  if (/^[A-Za-z]:\\/.test(detail)) return false;
  if (/\b(?:SELECT|INSERT|UPDATE|DELETE|syntax error)\b/i.test(detail)) return false;
  if (
    /\b(?:prisma|postgres|sequelize|mysql|mongodb|redis|sqlite|knex|typeorm|ECONNREFUSED)\b/i.test(
      detail,
    )
  ) {
    return false;
  }
  if (/\b(?:Traceback|Exception in thread)\b/i.test(detail)) return false;
  return true;
}

function statusFallback(err: ApiError, fallback: string): string {
  const code = normalizedCode(err);
  if (code && CODE_MESSAGES[code]) return CODE_MESSAGES[code]!;
  if (err.status === 401) {
    if (!code || code === "unauthorized" || code === "authentication_required") {
      return CODE_MESSAGES.unauthorized ?? fallback;
    }
    return fallback;
  }
  if (err.status === 403) {
    if (!code || code === "forbidden" || (code && MACHINE_CODE.test(code))) {
      return CODE_MESSAGES.forbidden ?? fallback;
    }
    return fallback;
  }
  return fallback;
}

/**
 * Operator-safe text for toasts and inline errors.
 * Unknown server detail is logged and replaced with `fallback`.
 */
export function operatorApiErrorMessage(err: unknown, fallback: string): string {
  if (!(err instanceof ApiError)) return fallback;

  const mapped = messageForKnownCode(err);
  if (mapped) return mapped;

  const detail = err.message.trim();
  if (detail && !MACHINE_CODE.test(detail) && isOperatorSafeDetail(detail)) {
    return detail;
  }

  if (import.meta.env.DEV) {
    console.warn("[api] suppressed server error detail", {
      status: err.status,
      code: err.code,
      message: err.message,
    });
  }

  return statusFallback(err, fallback);
}
