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
  delivery_not_created: "Could not create the delivery.",
  delivery_not_found: "Delivery not found.",
  duplicate_issuer: "An identity provider with this issuer already exists.",
  discovery_failed:
    "Could not fetch OIDC discovery from the issuer URL. Check the URL is reachable and exposes .well-known/openid-configuration.",
  email_conflict: "That email is already in use.",
  email_taken: "A user with this email already exists.",
  empty_file: "The file is empty.",
  asset_in_use:
    "This image is still used in this event's email template. Remove it from the template first.",
  asset_limit_reached: "This event has reached its image asset limit.",
  event_archived: "This event is archived.",
  event_full: "Event is at capacity.",
  export_too_large: "Export is too large. Narrow filters or export in parts.",
  field_in_use: "This field is used as a hint on an item. Remove it there first.",
  field_limit_reached: "This event has reached its custom field limit.",
  file_required: "Choose a file to upload.",
  file_too_large: "File exceeds the 2 MB limit.",
  forbidden: "You do not have access.",
  incomplete_transport: "Fill in all required fields for this mail transport before saving.",
  invalid_form_data: "Could not read the upload. Try again.",
  invalid_code: "Invalid authenticator code.",
  invalid_totp: "Invalid authenticator or backup code.",
  invalid_issuer:
    "Issuer URL must use HTTPS (http://localhost or http://127.0.0.1 is allowed in development only).",
  invalid_json: "Invalid request.",
  invalid_team_domain: "Enter a valid HTTPS Cloudflare Access team URL.",
  invalid_token: "Name must start with a letter and contain only lowercase letters, numbers, and underscores.",
  instance_url_required:
    "Set the Instance URL in Settings → General before sending ticket emails.",
  "invalid file content": "The file could not be read. Check that it is a valid CSV or XLSX.",
  item_in_use: "This item is in use and cannot be changed.",
  last_superadmin: "Cannot remove or deactivate the last superadmin.",
  managed_by_idp: "This role is managed by an identity provider and cannot be removed.",
  manual_lookup_disabled: "Manual lookup is disabled for this event — use QR scan only.",
  mappings_required: "Role mappings are required before enabling this provider.",
  no_local_password: "Password is managed by your identity provider.",
  not_admitted: "This attendee isn't currently checked in.",
  not_found: "The requested item was not found.",
  password_change_required:
    "You must change your password before continuing. Update it in Account or go to /change-password.",
  required_custom_data_field_missing: "A required custom field is missing.",
  reserved_token: "This name is already used as a built-in placeholder. Choose a different name.",
  resend_skipped: "Ticket email was not sent.",
  save_failed: "Save failed. Try again.",
  "server error": "Something went wrong. Try again.",
  setup_not_ready: "Complete the setup steps before finishing.",
  source_field_conflict: "A custom field with this key already exists for this event.",
  stale_write: "Someone else changed this record. Reload and try again.",
  template_in_use: "This template already has deliveries and cannot be deleted.",
  template_limit_reached: "Template limit reached for this event.",
  template_name_conflict: "A template with this name already exists.",
  template_not_found: "Template not found.",
  template_required: "Ticket template cannot be deleted.",
  template_validation_failed: "Fix template validation errors and try again.",
  team_domain_required: "Enter the Cloudflare Access team URL before testing the connection.",
  toggle_race: "Provider state changed. Reload and try again.",
  token_conflict: "This token is already used by another asset in this event.",
  too_many_attendees: "Too many attendees selected.",
  too_many_rows: "File exceeds the 50 000 row limit. Split the file and import in parts.",
  too_many_streams: "Too many live connections. Try again shortly.",
  totp_required: "Enter your authenticator app code to continue.",
  unauthorized: "Your session has expired. Sign in again.",
  unknown_content_field: "That field no longer exists. Reload and try again.",
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
    if (!code || code === "forbidden") {
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
