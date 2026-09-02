import { ApiError } from "./client.js";

const MACHINE_CODE = /^[a-z][a-z0-9_]*$/;

/** Known API error codes and operator-safe literals mapped to UI copy. Exported only for the
 * coverage guard in operator-api-error.coverage.test.ts, which checks every snake_case error
 * code the server can emit has an entry here (or explicit inline handling). Not meant as a
 * general-purpose lookup elsewhere; call operatorApiErrorMessage()/hasApiErrorCode() instead. */
export const CODE_MESSAGES: Record<string, string> = {
  actor_mfa_required:
    "You need a confirmed authenticator app, passkey, or security key on your own account before you can reset another superadmin's two-factor or password, or revoke their sessions. If you signed in through single sign-on and have no local password, you can't set one up yourself here - ask another superadmin who already has one confirmed to do this instead.",
  api_key_required:
    "API key is required for the Open-Meteo customer API (customer-api.open-meteo.com).",
  invalid_base_url: "Weather base URL must be a valid public http(s) URL.",
  invalid_geocoding_base_url: "Geocoding base URL must be a valid public http(s) URL.",
  url_host_blocked:
    "That URL must not point at a private or local network address.",
  url_host_unresolved: "Could not resolve that hostname. Check the URL and try again.",
  "hostname must not resolve to a private or link-local address":
    "That URL must not point at a private or local network address.",
  already_assigned: "This role assignment already exists.",
  already_enrolled: "Two-factor authentication is already enabled.",
  authentication_required: "Your session has expired. Sign in again.",
  body_required: "Request body is required.",
  bulk_send_rate_limited: "Bulk sends are limited to 3 requests every 10 minutes. Try again later.",
  cannot_change_own_role: "You cannot change your own role. Ask another superadmin.",
  cannot_deactivate_self: "You cannot deactivate your own account.",
  cannot_delete_self: "You cannot delete your own account.",
  cannot_remove_own_role: "You cannot remove your own role assignment. Ask another superadmin.",
  cannot_reset_mfa_sso_managed:
    "This account is managed by an identity provider. Unlink it first to reset local two-factor authentication.",
  cannot_reset_password_sso_managed:
    "This account is managed by an identity provider. Unlink it first to reset its local password.",
  cannot_unlink_own_sso: "You cannot unlink SSO from your own account. Ask another superadmin.",
  cannot_revoke_current: "You cannot revoke your current session.",
  cannot_revoke_own_session: "You cannot revoke your current session.",
  challenge_expired: "This passkey/security key setup request expired. Start again.",
  content_field_in_use: "This field is already shown on another item. Uncheck it there first.",
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
  geocoding_rate_limited: "Too many address lookups right now. Wait a moment and try again.",
  geocoding_unavailable: "Address lookup is temporarily unavailable. Try again shortly.",
  health_live_rate_limited: "Too many live checks right now. Wait a moment and try again.",
  idle_timeout_exceeds_absolute_lifetime:
    "Inactivity timeout cannot be longer than the maximum session lifetime.",
  incomplete_transport: "Fill in all required fields for this mail transport before saving.",
  internal_error: "Something went wrong. Try again. If it keeps happening, check System logs.",
  invalid_email: "Enter a valid email address.",
  invalid_form_data: "Could not read the upload. Try again.",
  invalid_image: "That file is not a valid image. Try another PNG, JPG, or WebP.",
  invalid_code: "Invalid authenticator code.",
  invalid_totp: "Invalid authenticator or backup code.",
  invalid_issuer:
    "Issuer URL must use HTTPS and must not target a private address unless listed in SSO_PRIVATE_DESTINATION_ALLOWLIST. http://localhost or http://127.0.0.1 is allowed in development only.",
  invalid_json: "Invalid request.",
  invalid_team_domain: "Enter a valid HTTPS Cloudflare Access team URL.",
  invalid_name: "Enter an image name with at least one letter (80 characters max).",
  invalid_token: "Name must start with a letter and contain only lowercase letters, numbers, and underscores.",
  upload_storage_unavailable:
    "File uploads are not available on this server. Ask a superadmin to check File storage under Settings → System health.",
  instance_url_required:
    "Set the Instance URL in Settings → General before sending ticket emails.",
  "invalid file content": "The file could not be read. Check that it is a valid CSV or XLSX.",
  item_in_use: "This item is in use and cannot be changed.",
  last_superadmin: "Cannot remove or deactivate the last superadmin.",
  legacy_name_requires_both_fields:
    "This attendee doesn't have separate first and last names yet. Set both fields together.",
  managed_by_idp: "This role is managed by an identity provider and cannot be removed.",
  manual_lookup_disabled: "Manual lookup is disabled for this event. Use QR scan only.",
  mail_not_configured:
    "Mail transport isn't configured for this event or organization. Set it up in Instance Settings → Mail (or this event's Mailing settings) before sending.",
  mail_destination_blocked:
    "The mail destination host resolves to a private address. Add it to MAIL_PRIVATE_DESTINATION_ALLOWLIST (app and worker), or use a public destination. Local labs can set ALLOW_PRIVATE_MAIL_DESTINATIONS=true when NODE_ENV is not production.",
  mail_destination_unresolved:
    "Could not resolve the mail destination hostname. Check Mail settings.",
  mail_secret_decryption_failed:
    "Stored mail credentials could not be decrypted. Re-enter the password or secret in Mail settings and save.",
  mappings_required: "Role mappings are required before enabling this provider.",
  no_local_password: "Password is managed by your identity provider.",
  not_admitted: "This attendee isn't currently checked in.",
  not_found: "The requested item was not found.",
  password_change_required:
    "You must change your password before continuing. Update it in Account or go to /change-password.",
  password_too_common: "This password is too common or predictable. Choose a different one.",
  required_custom_data_field_missing: "A required custom field is missing.",
  reserved_token: "This name is already used as a built-in placeholder. Choose a different name.",
  resend_skipped: "Ticket email was not sent.",
  save_failed: "Save failed. Try again.",
  "server error": "Something went wrong. Try again.",
  setup_not_ready: "Complete the setup steps before finishing.",
  source_field_conflict: "A custom field with this key already exists for this event.",
  source_provider_unavailable:
    "Select an enabled direct OIDC identity provider before enabling Cloudflare Access.",
  stale_write: "Someone else changed this record. Reload and try again.",
  template_in_use: "This template already has deliveries and cannot be deleted.",
  template_limit_reached: "Template limit reached for this event.",
  template_name_conflict: "A template with this name already exists.",
  template_not_found: "Template not found.",
  template_required: "Ticket template cannot be deleted.",
  template_validation_failed: "Fix template validation errors and try again.",
  ticket_not_issued: "This attendee can't be issued a ticket right now (cancelled, revoked, or missing an import reference).",
  team_domain_required: "Enter the Cloudflare Access team URL before testing the connection.",
  toggle_race: "Provider state changed. Reload and try again.",
  token_conflict: "This token is already used by another asset in this event.",
  too_many_attendees: "Too many attendees selected.",
  too_many_rows: "File exceeds the 50 000 row limit. Split the file and import in parts.",
  too_many_streams: "Too many live connections. Try again shortly.",
  "too many requests": "Too many requests. Wait a moment and try again.",
  totp_required: "Enter your authenticator app code to continue.",
  unauthorized: "Your session has expired. Sign in again.",
  unknown_content_field: "That field no longer exists. Reload and try again.",
  unknown_custom_data_field: "Unknown custom field.",
  unsupported_file_type: "Unsupported file type. Upload a PNG, JPG, or WebP image.",
  "unsupported file type": "Unsupported file type. Upload a .csv or .xlsx file.",
  validation_failed: "Check the form and try again.",
  verification_failed: "Could not verify the passkey/security key. Try again.",
  webauthn_disabled: "Passkeys and security keys are turned off for this instance. Ask an administrator to enable them.",
  wrong_password: "Current password is incorrect.",
  "file too large": "File exceeds the 5 MB limit. Split the file and import in parts.",
  "Note too long": "This note is too long. Shorten it and try again.",
  already_initialized: "This instance is already set up. Sign in instead.",
  "assetId required": "Image asset ID is missing from the request.",
  "attendeeId required": "Attendee ID is missing from the request.",
  attendee_not_issued: "This attendee hasn't been issued a ticket yet.",
  // Shared by save actions (event settings, branding) and destructive ones (archive, unarchive,
  // delete) alike - "save" framing would mislead on the latter, so this stays action-neutral.
  audit_failed: "This action could not be completed. Try again.",
  badge_item_inactive: 'Enable the badge item (or turn on "Issue on check-in") before badging at entry.',
  "body required": "Enter a note before saving.",
  bounce_probe_unavailable:
    "Could not set up the bounce-detection test. Check your mail settings and try again.",
  bulk_wallet_action_in_progress: "A wallet action is already running for this attendee. Wait for it to finish.",
  "credential id required": "Passkey/security key ID is missing from the request.",
  current_password_required: "Enter your current password to unlink single sign-on.",
  default_item: "The badge item can't be deleted. Disable it instead.",
  "deliveryId required": "Delivery ID is missing from the request.",
  device_label_too_long: "Device label is too long.",
  "empty file": "The file is empty.",
  "eventId required": "Event ID is missing from the request.",
  event_not_found: "Event not found.",
  "export_only is not allowed in production": "Export-only mail mode isn't allowed on a production instance.",
  "fieldId required": "Field ID is missing from the request.",
  "file required": "Choose a file to upload.",
  "format must be csv": "Export format must be CSV.",
  "format must be csv or pdf": "Export format must be CSV or PDF.",
  "format must be xlsx, csv, or pdf": "Export format must be XLSX, CSV, or PDF.",
  "id required": "ID is missing from the request.",
  insufficient_verification:
    "This account has no password or confirmed two-factor method to verify with. Ask a superadmin for help.",
  "invalid JSON": "Invalid request.",
  "invalid body": "Check the form and try again.",
  "invalid form data": "Could not read the upload. Try again.",
  "invalid json": "Invalid request.",
  invalid_body: "Could not read the request. Try again.",
  invalid_crop: "Crop settings are invalid. Adjust the crop and try again.",
  invalid_device_label: "Device label must be text.",
  invalid_event_id: "Invalid event ID.",
  invalid_org_id: "Invalid organization ID.",
  invalid_request: "Check the form and try again.",
  invalid_tile_url: "That map tile URL isn't valid. Check the format and try again.",
  invalid_type: 'Type must be "link" or "file".',
  invalid_upload_url: "That upload URL isn't valid.",
  invalid_url: "Enter a valid web address, starting with http:// or https://.",
  invalid_webauthn: "Could not verify the passkey/security key. Try again.",
  "itemId required": "Item ID is missing from the request.",
  "itemKey required": "Item key is missing from the request.",
  key_conflict: "That key is already in use. Try again.",
  label_conflict: "A ticket type with this name already exists.",
  "managed by environment": "This setting is controlled by an environment variable and can't be changed here.",
  missing_param: "Required information is missing from the request.",
  name_required: "Name is required.",
  no_credentials: "No passkey or security key is registered for this account.",
  no_wallet_pass: "This attendee has no wallet pass to act on.",
  "not found": "The requested item was not found.",
  not_a_select_field: "This field isn't a select-type field.",
  not_ready: "Export isn't ready yet. Try again in a moment.",
  "org_name required": "Organization name is required.",
  passkey_login_disabled: "Passkey sign-in is turned off for this instance.",
  "passwords do not match": "New password and confirmation don't match.",
  persisted_branding_url: "This file is still used as a logo, image, or font. Remove it there first.",
  persisted_image_asset: "This file is still used in this event's image library. Remove it there first.",
  provider_managed_roles_exist:
    "Some of your roles are managed by an identity provider. Ask an administrator to remove them first.",
  "q required": "Enter a search term.",
  reuse_smtp_unavailable:
    "This event's mail transport isn't SMTP, so its credentials can't be reused for bounce detection.",
  "scanned required": "No QR code or barcode was scanned.",
  "session id required": "Session ID is missing from the request.",
  session_not_editable: "This session can no longer be edited.",
  slug_taken: "An event with this URL slug already exists.",
  "targetState required": "Target state is missing from the request.",
  title_required: "Title is required.",
  "too many rows": "File exceeds the row limit. Split the file and import in parts.",
  "typeId required": "Ticket type ID is missing from the request.",
  type_in_use: "This ticket type is still assigned to attendees and can't be deleted.",
  type_limit_reached: "This event has reached its ticket type limit.",
  unknown_ticket_type: "That ticket type no longer exists in this event's catalog.",
  url_required: "URL is required.",
  "user id required": "User ID is missing from the request.",
  validation_error: "Check the form and try again.",
  wallet_not_configured: "Wallet isn't configured for this event.",
  wallet_pass_changed: "This wallet pass changed while updating. Reload and try again.",
  wallet_pass_not_refreshable:
    "This wallet pass was never registered with the provider, so its status can't be refreshed.",
  wallet_provider_duplicate: "The wallet provider already has a matching pass. Refresh and try again.",
  wallet_provider_not_found: "The wallet provider couldn't find this pass. It may have been removed there.",
  wallet_provider_rate_limited: "The wallet provider is rate-limiting requests. Wait a moment and try again.",
  wallet_provider_rejected: "The wallet provider rejected this request. Try again, or check the wallet configuration.",
  wallet_provider_timeout: "The wallet provider didn't respond in time. Try again.",
  wallet_provider_unauthorized: "The wallet provider rejected the configured API key. Check the wallet configuration.",
  wallet_push_already_running: "A push is already running for this event. Try again once it finishes.",
  wallet_status_check_inconclusive: "Could not confirm the wallet pass status. Try again shortly.",
  wallet_key_verification_failed:
    "This API key can't reach the event's currently configured Template ID, so it wasn't saved. If you're rotating a compromised key, make sure the new key belongs to the same PassCreator account - use Test connection to see the exact reason PassCreator gave.",
  wallet_template_locked:
    "Can't change the Template ID once wallet passes have been issued for this event - the wallet provider can't move an existing pass to a different template. Voiding a pass doesn't clear this; use each attendee's Delete wallet pass action first if you need to switch templates.",
  already_archived: "This event is already archived.",
  cf_access_jwt_invalid: "Cloudflare Access could not verify this request.",
  cf_access_no_admin_access: "Cloudflare Access is not granting you admin access. Check your Access policy.",
  event_not_deletable:
    "This event still has attendees, items, or other data attached, and can't be deleted. Remove that data first, or archive the event instead.",
  invalid_jwt: "Cloudflare Access token is invalid.",
  not_archived: "This event isn't archived.",
  not_deletable:
    "This event still has attendees, items, or other data attached, and can't be deleted. Remove that data first, or archive the event instead.",
  password_mismatch: "Passwords don't match.",
  password_too_short: "Password is too short.",
  resend_global_limit: "Too many ticket resends right now. Wait a moment and try again.",
  support_contact_required: "A support contact is required before this weather provider can be used. Set one in Settings.",
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

/** A Zod `.flatten()` field message is already written to be operator-safe (the schema's own
 * `.min()`/`.refine()` text), and names the actual field - shown ahead of the generic
 * `validation_failed` mapping whenever the server computed something more specific than
 * "Check the form and try again." `details` is parsed off any error body regardless of status or
 * code (client.ts's parseJson), so a response that isn't actually the server's Zod-validation
 * shape must not get a free pass around the same checks every other server detail goes through -
 * restricted to exactly the 400/validation_failed shape the server sends this on, and the joined
 * message still has to pass isOperatorSafeDetail (per-field text is safe by construction, but
 * several joined together could still exceed the length cap). */
function zodDetailMessage(err: ApiError): string | undefined {
  if (err.status !== 400 || normalizedCode(err) !== "validation_failed") return undefined;
  const fieldErrors = err.details?.fieldErrors;
  if (!fieldErrors) return undefined;
  const messages = Object.values(fieldErrors)
    .flatMap((value) => (Array.isArray(value) ? value : []))
    .filter((message): message is string => typeof message === "string" && message.trim().length > 0);
  if (messages.length === 0) return undefined;
  const joined = messages.join(" ");
  return isOperatorSafeDetail(joined) ? joined : undefined;
}

/**
 * Operator-safe text for toasts and inline errors.
 * Unknown server detail is logged and replaced with `fallback`.
 */
export function operatorApiErrorMessage(err: unknown, fallback: string): string {
  if (!(err instanceof ApiError)) return fallback;

  const fieldDetail = zodDetailMessage(err);
  if (fieldDetail) return fieldDetail;

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
