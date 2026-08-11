import type { DeliveryDto, HealthOverallStatus, HealthRowStatus } from "@admitto/shared";
import type { LogoPersistenceDto } from "@admitto/mail-templates";

// DeliveryDto is also used locally below (AttendeeDetailDto.deliveries, the deliveries-list
// response's items) so this file still needs its own bound import above - DeliveryDetailDto
// isn't used locally, only re-exported, so it's not repeated in that import (Sonar S1128).
export type { DeliveryDetailDto, DeliveryDto, HealthOverallStatus, HealthRowStatus } from "@admitto/shared";
export type { EventSettingsDto, LogoCropMeta, LogoPersistenceDto } from "@admitto/mail-templates";

export type MailerProvider = "smtp" | "graph" | "powerautomate" | "export_only";
export type PreferredTimeFormat = "12h" | "24h";

export interface MailerStatus {
  configured: boolean;
  provider: MailerProvider | null;
}

export interface AuthUser {
  id: string;
  email: string;
  display_name: string | null;
  preferred_locale?: string | null;
  preferred_time_format?: PreferredTimeFormat | null;
  is_active: boolean;
  created_at: string;
  mailer_status?: MailerStatus | null;
}

export interface RoleAssignment {
  role: string;
  scope_type: string;
  scope_id: string | null;
}

export interface MeResponse {
  user: AuthUser;
  assignments: RoleAssignment[];
  device_label?: string | null;
  session_active: boolean;
  mailer_status?: MailerStatus | null;
  setup_complete?: boolean;
}

export interface EventDto {
  id: string;
  title: string;
  slug: string;
  date: string;
  timezone: string;
  /** Display-only 24h "HH:MM" shown on tickets/wallet passes; independently optional. */
  event_hours_start: string | null;
  event_hours_end: string | null;
  location: string | null;
  /** True when EventLocation has both latitude and longitude. */
  has_coordinates?: boolean;
  /**
   * Same-origin list preview path (`/m/{id}.png?v=…&context=list`) when maps are enabled
   * and a pin exists; null otherwise (show the card placeholder — do not request `/m/`).
   */
  map_preview_path?: string | null;
  /**
   * Plain-text map credit for the card strip when `map_preview_path` is set (from
   * `MAP_TILE_ATTRIBUTION` / default OSM). List PNGs omit burn-in so the pin stays centered.
   */
  map_attribution?: string | null;
  /**
   * Event-day forecast when weather is enabled and the event has a pin.
   * Provider may be MET Norway or Open-Meteo (see attribution fields).
   * Omitted when weather is disabled or there are no coordinates.
   */
  weather?: {
    status: "ok" | "too_far" | "unavailable";
    temp_c?: number;
    temp_min_c?: number;
    weather_code?: number;
    opens_in_days?: number;
    horizon_days?: number;
    attribution?: string;
    attribution_url?: string;
  } | null;
  organization_id: string;
  attendee_count?: number;
  archived_at: string | null;
  created_at?: string;
  created_by_display_name?: string | null;
  created_by_email?: string | null;
  created_by_timezone?: string | null;
  archived_by_display_name?: string | null;
  archived_by_email?: string | null;
  archived_by_timezone?: string | null;
}

export interface CreateEventBody {
  title: string;
  slug: string;
  date: string;
  timezone: string;
  /** Display-only 24h "HH:MM" shown on tickets/wallet passes; independently optional. */
  event_hours_start?: string;
  event_hours_end?: string;
  /** Short display name, e.g. "National Stadium" - free text, or picked from a geocoding
   * suggestion alongside the fields below. */
  venue_name?: string;
  formatted_address?: string;
  latitude?: number;
  longitude?: number;
  geocoding_provider?: string;
}

/** One uploaded font file for a specific weight+style within a custom font family - a real
 * family needs one of these per weight/style it has for the browser to render a true bold/
 * italic instead of a synthesized (faked) one. */
export interface BrandingFontVariantDto {
  weight: number;
  style: "normal" | "italic";
  url: string;
}

/** A saved custom font family - a name plus every weight/style file uploaded for it, kept as a
 * library so switching back to a previously-uploaded family doesn't need re-uploading. */
export interface BrandingCustomFontFamilyDto {
  name: string;
  variants: BrandingFontVariantDto[];
}

export interface BrandingThemeDto {
  primary?: string;
  /** The active pick for the admin staff SPA - either a built-in name (e.g. "Manrope") or one of
   * custom_font_families[].name. */
  font_family_name?: string;
  /** The active pick for the public ticket page - same rules as font_family_name, falls back to
   * it when unset so a single global font remains the default until someone overrides it. */
  ticket_font_family_name?: string;
  custom_font_families?: BrandingCustomFontFamilyDto[];
}

export interface ThemeResponse {
  theme: BrandingThemeDto;
  vars: Record<string, string>;
}

export type CheckInStatus =
  | "VALID"
  | "ALREADY_CHECKED_IN"
  | "REVOKED"
  | "INVALID"
  | "PREVIEW";

export interface AttendeeCardItemDto {
  key: string;
  label: string;
  /** Admin-configured item description (Requirements page), capped at 500 chars server-side. */
  description?: string | null;
  icon: string | null;
  state: string;
  actions: string[];
  detail?: string | null;
}

export interface AttendeeCardDto {
  id: string;
  name: string;
  company: string | null;
  department: string | null;
  ticket_type: string | null;
  check_in_status: "not_admitted" | "admitted";
  admitted_at: string | null;
  items: AttendeeCardItemDto[];
  notes: { body: string; author_display: string; created_at: string }[];
  /** True when the pass itself isn't admittable (cancelled/revoked). */
  blocked: boolean;
}

export interface LookupAttendeeResult {
  id: string;
  name: string;
  ticket_type: string | null;
  company: string | null;
  department: string | null;
  check_in_status: "not_admitted" | "admitted";
}

export interface CheckInScanResponse {
  status: CheckInStatus;
  confirmed: boolean;
  card?: AttendeeCardDto;
  attendeeId?: string;
  admittedAt?: string;
}

export interface CheckInHistoryEntry {
  id: string;
  event_id: string;
  attendee_id: string;
  status: string;
  checked_in_at: string;
  checked_in_by: string | null;
  device_id: string | null;
  source: string | null;
  attendee: {
    name: string;
    ticket_type: string | null;
    company?: string | null;
    department?: string | null;
  };
}

export interface CheckInStatsResponse {
  admitted_count: number;
  total_count: number;
}

export type RsvpStatus = "none" | "confirmed" | "declined" | "tentative" | "cancelled";

import type { AttendeeStatus } from "@admitto/db/status";

export interface AttendeeRowDto {
  id: string;
  name: string;
  email: string;
  company: string | null;
  department: string | null;
  ticket_type: string | null;
  status: AttendeeStatus;
  check_in_status: "admitted" | "not_admitted";
  admitted_at: string | null;
  updated_at: string;
  last_mail_status: string | null;
  rsvp_status: RsvpStatus;
  /** Whether this attendee currently has at least one issued/returned item hand-out — lets the
   * bulk "Revoke items" action report how many of the selection it would actually affect. */
  has_issued_items: boolean;
}

/** Redacted rendered message for the "View sent message" preview — the recipient's real QR
 * code/ticket link are never included, by design (see communication-api-routes.ts). */
export interface RenderedDeliveryDto {
  subject: string | null;
  html: string | null;
}

export interface AttendeeActionLogEntryDto {
  id: string;
  action_type: string;
  actor_display: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  /** Acting admin's IANA timezone at write time, when known. */
  client_timezone: string | null;
}

export interface AttendeeDetailItemDto {
  key: string;
  label: string;
  icon: string | null;
  state: string;
}

export type NoteAuthorRole = "superadmin" | "admin" | "operator" | null;

export interface AttendeeNoteDto {
  id: string;
  body: string;
  author_display: string;
  author_user_id: string;
  author_role: NoteAuthorRole;
  created_at: string;
}

export interface AttendeeDetailDto {
  id: string;
  name: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  company: string | null;
  department: string | null;
  ticket_type: string | null;
  status: AttendeeStatus;
  check_in_status: "admitted" | "not_admitted";
  created_at: string;
  admitted_at: string | null;
  /** Acting admin's IANA timezone at attendee-creation time, when known (manual add / import). */
  client_timezone: string | null;
  updated_at: string;
  rsvp_status: RsvpStatus;
  rsvp_source: string | null;
  rsvp_updated_at: string | null;
  custom_data: unknown;
  deliveries: DeliveryDto[];
  action_log: AttendeeActionLogEntryDto[];
  event_items: AttendeeDetailItemDto[];
  notes_total: number;
  notes: AttendeeNoteDto[];
  notes_page_size: number;
  notes_page: number;
}

export interface AttendeesListResponse {
  items: AttendeeRowDto[];
  total: number;
  page: number;
  pageSize: number;
}

/** Whitelisted sortable columns, mirroring ATTENDEE_SORT_COLUMNS in packages/tickets. */
export type AttendeeSortBy = "name" | "ticket_type" | "company" | "rsvp_status" | "status" | "admitted_at";
export type AttendeeSortDir = "asc" | "desc";

/** Latest-delivery mail filter buckets — mirrors ATTENDEE_MAIL_STATUS_FILTERS server-side. */
export type AttendeeMailStatusFilter = "not_sent" | "sent" | "pending" | "failed";

export interface AttendeesListParams {
  page?: number;
  pageSize?: number;
  q?: string;
  status?: "all" | "admitted" | "not_admitted";
  ticket_type?: string;
  rsvp_status?: RsvpStatus;
  mail_status?: AttendeeMailStatusFilter;
  sortBy?: AttendeeSortBy;
  sortDir?: AttendeeSortDir;
}

export interface UpdateAttendeePatch {
  first_name?: string;
  last_name?: string;
  email?: string;
  company?: string | null;
  department?: string | null;
  ticket_type?: string | null;
  custom_data_fields?: Record<string, string | null>;
  rsvp_status?: RsvpStatus;
  status?: "registered" | "revoked";
  expected_updated_at?: string;
}

export interface EventFullErrorBody {
  code: "event_full";
  error: string;
  capacity: number;
  current: number;
  incoming?: number;
  projected?: number;
}

export interface ResendTicketBody {
  to?: string;
  /** Resend this specific template instead of the event's current default - the Delivery log
   * row's "Resend" passes the row's own template_id so it resends what actually bounced/failed. */
  templateId?: string;
}

export interface DismissBounceResponse {
  email_bounce_dismissed_at: string;
}

export interface ImportInvalidRow {
  rowIndex: number;
  reason: string;
}

/** One valid CSV row in the import preview sample (mirrors web ImportSampleRow). */
export interface ImportSampleRow {
  rowIndex: number;
  name: string;
  email: string;
  ticket_type: string;
  company: string;
  department: string;
  external_uuid: string;
  custom_data: Record<string, string>;
}

export interface ImportPreviewResponse {
  importId: string;
  parse: {
    validCount: number;
    /** Capped server-side; invalidCount is the true total. */
    invalidRows: ImportInvalidRow[];
    invalidCount: number;
    warnings: string[];
  };
  summary: {
    toCreate: number;
    toUpdate: number;
    toSkip: number;
    /** Capped server-side; toSkip above is the true total. */
    skipped: ImportSkippedRow[];
  };
  sampleRows: ImportSampleRow[];
  attributeFieldLabels: Array<{ source_field: string; label: string }>;
}

export interface ImportSkippedRow {
  email: string;
  reason: string;
}

export interface ImportCommitResponse {
  importId: string;
  toCreate: number;
  toUpdate: number;
  toSkip: number;
  created: number;
  updated: number;
  /** Capped server-side; skippedCount is the true committed total when present. */
  skipped: ImportSkippedRow[];
  /** Uncapped committed skip total (preferred over skipped.length). */
  skippedCount?: number;
  /** Rows dropped by the commit-time re-parse before ever reaching the write step (e.g. a ticket
   * type deleted from the catalog between preview and commit) - absent from created/updated/skipped.
   * Capped server-side; invalidCount is the true total. */
  invalidRows: ImportInvalidRow[];
  invalidCount: number;
}

/** 202 enqueue response from POST …/import/commit. */
export interface ImportCommitQueuedResponse {
  jobId: string;
  status: "pending";
  importId: string;
}

/** Poll payload from GET …/import/jobs/:jobId. */
export interface ImportJobStatusResponse {
  jobId: string;
  status: "pending" | "running" | "succeeded" | "failed";
  importId: string | null;
  error: string | null;
  result: ImportCommitResponse | null;
  /** ISO time the job row was created (client poll deadline while pending). */
  created_at: string;
  /** ISO time the worker claimed the job, if any (poll deadline while running). */
  started_at: string | null;
}

/** Bulk ticket send queue summary from POST .../attendees/bulk-resend. */
export interface BulkResendResponse {
  /** Batch id for status polling when rows were queued. */
  batchId: string | null;
  /** Delivery rows left in `queued` for the worker to drain. */
  queued: number;
  skipped: number;
  /** Always 0 at enqueue time; terminal failures appear on status poll. */
  failed: number;
}

/** Bulk manual check-in summary from POST .../attendees/bulk-checkin. */
export interface BulkCheckInResponse {
  checkedIn: number;
  alreadyCheckedIn: number;
  /** Pass revoked / cancelled attendee - not admittable. */
  revoked: number;
  /** Id no longer valid for this event by the time the check-in ran. */
  invalid: number;
  /** admitAttendee threw for this id (unexpected, e.g. a data-consistency guard) - safe to retry. */
  errored: number;
}

/** Bulk revoke-items summary from POST .../attendees/bulk-revoke-items. */
export interface BulkRevokeItemsResponse {
  /** Individual item hand-outs reset back to pending, across the whole selection. */
  revokedCount: number;
}

/** Bulk revoke-check-in summary from POST .../attendees/bulk-revoke-checkin. */
export interface BulkRevokeCheckInResponse {
  revoked: number;
  /** Wasn't currently checked in (or lost a concurrent race) - nothing to revoke. */
  notAdmitted: number;
  /** Attendee's pass is already revoked/cancelled, blocking the item-reset cascade. */
  blocked: number;
  /** revokeCheckInMutation threw for this id (unexpected) - safe to retry. */
  errored: number;
}

/** Bulk revoke-pass summary from POST .../attendees/bulk-revoke-pass. */
export interface BulkRevokePassResponse {
  revoked: number;
  /** Already revoked or cancelled - nothing to revoke, left untouched. */
  skipped: number;
  /** revokeOneAttendeePass threw for this id (unexpected) - safe to retry. */
  errored: number;
}

/** Admin SPA DTOs for event item configuration (mirror of web API).
 * `content_fields` references EventCustomField rows by source_field (see below) - it does not
 * embed field definitions. */
export interface EventItemConfigDto {
  content_fields?: string[];
  requires_return?: boolean;
  issue_on_checkin?: boolean;
}

export interface EventItemDto {
  id: string;
  key: string;
  label: string;
  description: string | null;
  type: string;
  enabled: boolean;
  icon: string | null;
  config: EventItemConfigDto | null;
}

export interface EventItemsListResponse {
  items: EventItemDto[];
}

/** A named branding image asset, usable as `{{token}}` in email templates. */
export interface EventImageAssetDto {
  id: string;
  token: string;
  filename: string;
  url: string;
  size_bytes: number;
  mime_type: string;
  created_at: string;
}

export interface EventImageAssetsListResponse {
  items: EventImageAssetDto[];
}

export type EventCustomFieldType = "text" | "select" | "boolean";

/** A definition in the event's custom attendee data field registry (dietary, shirt size, ...) -
 * the single source of truth for a field; EventItem.config.content_fields only references these
 * by source_field. */
export interface EventCustomFieldDto {
  id: string;
  source_field: string;
  label: string;
  description: string | null;
  type: EventCustomFieldType;
  required: boolean;
  options: string[] | null;
  created_at: string;
}

export interface EventCustomFieldsListResponse {
  items: EventCustomFieldDto[];
}

export interface CreateEventCustomFieldBody {
  source_field: string;
  label: string;
  description?: string;
  type?: EventCustomFieldType;
  required?: boolean;
  options?: string[];
}

/** `source_field` is immutable after create - see EventCustomFieldDto. */
export interface UpdateEventCustomFieldPatch {
  label?: string;
  /** null clears a previous description; omit to leave it untouched. */
  description?: string | null;
  type?: EventCustomFieldType;
  required?: boolean;
  /** null clears a previous select's options; omit to leave options untouched. */
  options?: string[] | null;
}

/** The 8 curated colors a ticket type may use - kept in sync by hand with
 * packages/tickets/src/ticket-types.ts's TICKET_TYPE_COLOR_KEYS and
 * packages/ui/src/components/TicketTypeBadge.tsx's TICKET_TYPE_COLORS. */
export type TicketTypeColor = "gray" | "blue" | "green" | "yellow" | "red" | "azure" | "teal" | "purple";

/** A per-event ticket type (batch 04 / #351) - the single source of truth for a type's label and
 * color; `key` is immutable after create. */
export interface TicketTypeDto {
  id: string;
  key: string;
  label: string;
  color: TicketTypeColor;
  sort_order: number;
  attendee_count: number;
  created_at: string;
}

export interface TicketTypesListResponse {
  items: TicketTypeDto[];
}

export interface CreateTicketTypeBody {
  label: string;
  color?: TicketTypeColor;
}

/** `key` is immutable after create - see TicketTypeDto. */
export interface UpdateTicketTypePatch {
  label?: string;
  color?: TicketTypeColor;
}

export interface CreateEventItemBody {
  key: string;
  label: string;
  description?: string;
  icon?: string;
  config?: EventItemConfigDto;
}

export interface UpdateEventItemPatch {
  label?: string;
  description?: string | null;
  enabled?: boolean;
  icon?: string | null;
  config?: EventItemConfigDto;
}

export interface OpsConfigDto {
  require_confirm_on_scan: boolean;
  badge_at_entry: boolean;
  allow_manual_lookup: boolean;
  auto_advance_on_valid: boolean;
}

export interface UpdateOpsConfigPatch {
  require_confirm_on_scan?: boolean;
  badge_at_entry?: boolean;
  allow_manual_lookup?: boolean;
  auto_advance_on_valid?: boolean;
}

/** Admin SPA DTOs for event mail template editing and delivery log (mirror of web API). */
export interface EventTemplateDto {
  subject_template: string;
  body_template: string;
  template_format: "mjml" | "html";
  source: "event" | "organization" | "builtin";
  allowed_placeholders: string[];
  required_url_placeholders: string[];
  /** Subset of `allowed_placeholders` that render as an image — the editor inserts a ready
   * `<img>`/`<mj-image>` element for these instead of a bare `{{name}}` token. */
  image_placeholders: string[];
  /** Resolved `{{logo_url}}` / `{{header_image_url}}` (event → organization → empty) - the same
   * values a real send would use, for the placeholder-chip hover preview. Empty string means
   * nothing is configured at either scope. */
  logo_url: string;
  header_image_url: string;
}

export interface SaveTemplateBody {
  subject_template: string;
  body_template: string;
  template_format: "mjml" | "html";
}

/** Identity-only edit for PATCH .../templates/:id - label/icon/description, no content or
 * format. `null` (icon/description only) clears the field back to its picker-side default. */
export interface UpdateTemplateMetadataBody {
  label?: string;
  icon?: string | null;
  description?: string | null;
}

export interface PreviewTemplateResponse {
  subject: string;
  html: string;
}

export interface TestSendBody {
  to: string;
}

/** Event/ticket template test-send — communication-api-routes.ts never reports a
 * provider for this endpoint, unlike the mail-transport test-send below. */
export type TemplateTestSendResponse =
  | { status: "sent" }
  | { status: "failed"; error: string };

/** Instance Settings -> Mail transport test-send — mail-settings-routes.ts always
 * includes the provider on success (see the route's own `satisfies` clause). */
export type MailBounceProbeDto = {
  status: "ok" | "timeout" | "failed";
  message: string;
  smtpCode?: string | null;
};

export type MailTransportTestSendResponse =
  | {
      status: "sent";
      provider: MailProvider;
      providerMessageId?: string;
      bounceProbe?: MailBounceProbeDto;
    }
  | {
      status: "failed";
      error: string;
      provider?: MailProvider;
      retryable?: boolean;
      bounceProbe?: MailBounceProbeDto;
    };

/** Multi-template list item from GET .../templates. */
export interface MailTemplateListItem {
  id: string;
  name: string;
  label: string;
  icon: string | null;
  description: string | null;
  template_format: "mjml" | "html";
  subject_template: string;
  updated_at: string;
}

/** Full template row from GET .../templates/:id. */
export interface MailTemplateDetail extends MailTemplateListItem {
  body_template: string;
  /** Present on API responses; admin editor does not consume compiled output. */
  compiled_html_template?: string;
}

/** Audience filter for POST `/api/admin/events/:eventId/send`. */
export type BulkSendFilter =
  | { type: "all" }
  | { type: "ticket_type"; value: string }
  | { type: "rsvp_status"; value: RsvpStatus }
  | { type: "no_delivery" }
  | { type: "attendee_ids"; ids: string[] };

/** Request body for bulk mail send (dry-run or queue). Omitted templateId -> the
 * built-in default ("ticket") template, same fallback the simpler bulk-resend
 * endpoint already gets. */
export interface BulkSendBody {
  templateId?: string;
  filter: BulkSendFilter;
  dryRun?: boolean;
}

/** Dry-run response with the resolved recipient count only. */
export interface BulkSendDryRunResponse {
  recipientCount: number;
}

/** Queue response after POST `/send` with `dryRun: false`. */
export interface BulkSendQueuedResponse {
  batchId: string | null;
  queued: number;
  skipped: number;
  failed: number;
}

/** Batch progress from GET `/send/:batchId/status`. */
export interface BulkSendStatusResponse {
  batchId: string;
  total: number;
  queued: number;
  sent: number;
  failed: number;
}

export type MailFieldSource = "env" | "db" | "default";

export interface MailPlainFieldDto<T = string | number | boolean | null> {
  value: T;
  source: MailFieldSource;
  locked: boolean;
}

export interface MailSecretFieldDto {
  set: boolean;
  masked: "••••" | null;
  source: MailFieldSource;
  locked: boolean;
}

export type MailProvider = "smtp" | "graph" | "powerautomate" | "export_only";

export interface MailSettingsFieldsDto {
  provider: MailPlainFieldDto<MailProvider | null>;
  fromAddress: MailPlainFieldDto<string | null>;
  fromName: MailPlainFieldDto<string | null>;
  replyTo: MailPlainFieldDto<string | null>;
  envelopeFrom: MailPlainFieldDto<string | null>;
  allowedFromDomain: MailPlainFieldDto<string | null>;
  host: MailPlainFieldDto<string | null>;
  port: MailPlainFieldDto<number | null>;
  secure: MailPlainFieldDto<boolean | null>;
  user: MailPlainFieldDto<string | null>;
  requireTls: MailPlainFieldDto<boolean | null>;
  tlsRejectUnauthorized: MailPlainFieldDto<boolean | null>;
  heloName: MailPlainFieldDto<string | null>;
  pool: MailPlainFieldDto<boolean | null>;
  maxConnections: MailPlainFieldDto<number | null>;
  maxMessages: MailPlainFieldDto<number | null>;
  rateLimitPerMinute: MailPlainFieldDto<number | null>;
  connectionTimeout: MailPlainFieldDto<number | null>;
  greetingTimeout: MailPlainFieldDto<number | null>;
  socketTimeout: MailPlainFieldDto<number | null>;
  smtpPassword: MailSecretFieldDto;
  mailbox: MailPlainFieldDto<string | null>;
  tenantId: MailPlainFieldDto<string | null>;
  clientId: MailPlainFieldDto<string | null>;
  saveToSentItems: MailPlainFieldDto<boolean | null>;
  graphClientSecret: MailSecretFieldDto;
  powerAutomateUrl: MailSecretFieldDto;
  powerAutomateKey: MailSecretFieldDto;
}

export interface MailSettingsResponse {
  organizationId: string;
  isProduction: boolean;
  fields: MailSettingsFieldsDto;
}

/** Event-scoped mail transport (#511) — fields are the *effective* (resolved) values,
 * inherited from the organization when hasEventOverride is false. */
export interface EventMailSettingsResponse {
  eventId: string;
  organizationId: string;
  isProduction: boolean;
  hasEventOverride: boolean;
  /** Deliveries still marked retryable after failing — not time-windowed, so nonzero can mean
   * "weeks-old and unresolved," not "just happened" (see the route's own comment). */
  failedDeliveries: number;
  fields: MailSettingsFieldsDto;
}

/** Event-scoped IMAP bounce / NDR ingest settings (ADR 0039). */
export interface EventBounceIngestLastRunDto {
  at: string;
  ok: boolean;
  messagesSeen: number;
  bouncesApplied: number;
  softBouncesLogged: number;
  unparsed: number;
  noMatchingDelivery: number;
  errors: number;
  connectFailed: boolean;
}

export interface EventBounceIngestSettingsResponse {
  eventId: string;
  organizationId: string;
  configured: boolean;
  enabled: boolean;
  imap_host: string | null;
  imap_port: number | null;
  imap_username: string | null;
  imap_password: {
    set: boolean;
    masked: "••••" | null;
    from_smtp?: boolean;
  };
  reuse_smtp_credentials: boolean;
  smtp_reuse_available: boolean;
  folders: string[];
  poll_interval_minutes: number;
  /** Null until bounce-ingest records a run (not updated by Test connection). */
  lastRun: EventBounceIngestLastRunDto | null;
  /** Newest-first recent automatic checks (capped server-side). */
  recentRuns?: EventBounceIngestLastRunDto[];
}

export interface SaveEventBounceIngestSettingsBody {
  imap_host?: string;
  imap_port?: number | null;
  imap_username?: string;
  imap_password?: string;
  clear_imap_password?: boolean;
  reuse_smtp_credentials?: boolean;
  folders?: string[];
  poll_interval_minutes?: number | null;
  enabled?: boolean;
}

export interface BounceIngestTestResponse {
  ok: boolean;
  message?: string;
  error?: string;
}

export interface BounceIngestRunResponse {
  ok: boolean;
  lastRun: EventBounceIngestLastRunDto | null;
  recentRuns?: EventBounceIngestLastRunDto[];
  message: string;
  error?: string;
}

/** SMTP connection probe (nodemailer verify, no send) — org or event dedicated SMTP. */
export type MailSmtpProbeResponse = BounceIngestTestResponse;

export interface SaveMailSettingsBody {
  /** Omit = unchanged; `""` clears stored provider (Not configured). */
  provider?: MailProvider | "";
  fromAddress?: string;
  fromName?: string;
  replyTo?: string;
  envelopeFrom?: string;
  allowedFromDomain?: string;
  host?: string;
  port?: number | null;
  secure?: boolean;
  user?: string;
  requireTls?: boolean;
  tlsRejectUnauthorized?: boolean;
  heloName?: string;
  pool?: boolean;
  maxConnections?: number | null;
  maxMessages?: number | null;
  rateLimitPerMinute?: number | null;
  connectionTimeout?: number | null;
  greetingTimeout?: number | null;
  socketTimeout?: number | null;
  smtpPassword?: string;
  mailbox?: string;
  tenantId?: string;
  clientId?: string;
  saveToSentItems?: boolean;
  graphClientSecret?: string;
  powerAutomateUrl?: string;
  powerAutomateKey?: string;
}

export interface EventDeliveriesListParams {
  page?: number;
  pageSize?: number;
  status?: "all" | "queued" | "accepted" | "sent" | "delivered" | "failed" | "bounced" | "rejected";
  purpose?: "all" | "initial" | "resend";
  /** Case-insensitive match against attendee name/email. */
  search?: string;
  /** Filter to a specific custom template id, or the literal string "default" for deliveries
   * sent with the built-in template (`template_id` is null). */
  templateId?: string;
}

export interface EventDeliveriesListResponse {
  items: DeliveryDto[];
  total: number;
  page: number;
  pageSize: number;
}

/** Event Settings "Location" tab — venue name, full address, coordinates, and directions/
 * accessibility notes for an event's venue. The single source of truth for an event's
 * location (no separate Basic Information field). */
export interface AddressComponentsDto {
  object_name: string | null;
  street: string | null;
  postcode: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
}

/** Event Settings "Location" tab — full address, map coordinates/zoom, and directions/
 * accessibility notes for an event's venue. The single source of truth for an event's
 * location (no separate Basic Information field). */
export interface EventLocationDto {
  /** Short display name (e.g. "National Stadium") - the single source of truth for an
   * event's location, replacing the old Basic Information "Location" field. */
  venue_name: string | null;
  formatted_address: string | null;
  latitude: number | null;
  longitude: number | null;
  map_zoom: number;
  directions_text: string | null;
  accessibility_text: string | null;
  /** e.g. "nominatim" once set via a geocoding search result; null after a manual pin drag,
   * a manually typed coordinate, or "Clear map location" — see event-location-routes.ts. */
  geocoding_provider: string | null;
  geocoded_at: string | null;
  address_components: AddressComponentsDto | null;
  /** Manual Google Maps deep link when the pin-built URL is wrong; null = build from coords. */
  google_maps_url_override: string | null;
  /** Manual Apple Maps deep link when the pin-built URL is wrong; null = build from coords. */
  apple_maps_url_override: string | null;
}

export interface SaveEventLocationBody {
  /** Omit = unchanged; `null` (or "" for text fields) clears it. */
  venue_name?: string | null;
  formatted_address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  map_zoom?: number | null;
  directions_text?: string | null;
  accessibility_text?: string | null;
  address_components?: AddressComponentsDto | null;
  google_maps_url_override?: string | null;
  apple_maps_url_override?: string | null;
  /** Only meaningful alongside a latitude/longitude change for stamping a provider; send `null`
   * without a coordinate change to clear stale Verified provenance (e.g. free-text venue rename).
   * Omit for a manual pin move so the server clears provenance via the coordinate-change path. */
  geocoding_provider?: string | null;
}

export interface GeocodingResultDto {
  /** Localized place/POI name (e.g. "ICE Kraków Congress Centre") when the match is a named
   * venue rather than a bare address - absent for plain street-address matches. */
  name?: string;
  formatted_address: string;
  latitude: number;
  longitude: number;
  provider: string;
  components?: AddressComponentsDto;
}

export interface GeocodingSearchResponse {
  results: GeocodingResultDto[];
  /** False when the organisation has no Support contact configured — Nominatim's usage policy
   * asks for an identifiable contact; search still works, the UI just shows a hint. */
  contact_configured: boolean;
}

export interface GeocodingReverseResponse {
  /** Null when the coordinate has no OSM coverage. */
  result: GeocodingResultDto | null;
  contact_configured: boolean;
}

export interface GeocodingTimezoneResponse {
  /** Primary IANA timezone for the pin, or null when geo-tz has no match. */
  timezone: string | null;
}

export interface MapTileConfigDto {
  enabled: boolean;
  tile_url: string;
  attribution: string;
  max_zoom: number;
  /** Same flag as GeocodingSearchResponse.contact_configured — loaded with the map config
   * so the Location tab can show the Support-contact notice before any search runs. */
  contact_configured: boolean;
}

/** Organisation Settings → External services (ADR 0040). */
export type WeatherProviderId = "openmeteo" | "metno";

export interface ExternalServicesWeatherDto {
  enabled: boolean;
  provider: WeatherProviderId;
  base_url: string;
  api_key: { configured: boolean; source: "organization" | "none" };
  attribution: string;
  attribution_url: string;
  commercial_notice: string;
  horizon_days: number;
  contact_configured: boolean;
}

export interface ExternalServicesMapsDto {
  enabled: boolean;
  tile_url: string;
  attribution: string;
  max_zoom: number;
  geocoding_provider: string;
  geocoding_base_url: string;
}

export interface ExternalServicesResponse {
  weather: ExternalServicesWeatherDto;
  maps: ExternalServicesMapsDto;
}

export interface SaveWeatherSettingsBody {
  enabled?: boolean;
  provider?: WeatherProviderId;
  baseUrl?: string | null;
  apiKey?: string | null;
}

export interface SaveMapsSettingsBody {
  enabled?: boolean;
  tileUrl?: string | null;
  attribution?: string | null;
  maxZoom?: number | null;
  geocodingProvider?: string | null;
  geocodingBaseUrl?: string | null;
}

/** POST /api/admin/external-services/weather/test (draft, no persist). */
export interface WeatherConnectionTestBody {
  provider: WeatherProviderId;
  baseUrl?: string;
  apiKey?: string;
  clearApiKey?: boolean;
}

/** POST /api/admin/external-services/maps/test (draft, no persist). */
export interface MapsConnectionTestBody {
  geocodingBaseUrl: string;
}

export type ExternalServicesConnectionTestResponse = BounceIngestTestResponse & {
  latency_ms?: number;
};

export type SessionRole = "superadmin" | "admin" | "operator";
export type SettingSource = "env" | "db" | "default";

export type IpLocationKind = "internal" | "resolved" | "unknown";

/** Mirrors IpLocation from apps/web/src/rate-limit/ip-location.ts. */
export interface IpLocationDto {
  kind: IpLocationKind;
  countryCode?: string;
}

export interface SessionListDto {
  id: string;
  userId: string;
  userEmail: string;
  userDisplayName: string | null;
  role: SessionRole;
  deviceLabel: string | null;
  ip: string | null;
  country: IpLocationDto;
  userAgent: string | null;
  loginAt: string;
  lastSeenAt: string;
  expiresAt: string;
  authMethod: string;
  stage: string;
  /** Signer's IANA timezone at login — null for older sessions / non-browser captures. */
  timezone: string | null;
  isCurrent: boolean;
}

export interface SessionsResponse {
  sessions: SessionListDto[];
}

export interface SecuritySettingField<T> {
  value: T;
  source: SettingSource;
}

export interface SystemSettingsDto {
  session_ttl_ms: SecuritySettingField<number>;
  operator_session_ttl_ms: SecuritySettingField<number>;
  session_idle_timeout_ms: SecuritySettingField<number>;
  operator_session_idle_timeout_ms: SecuritySettingField<number>;
  trusted_device_days: SecuritySettingField<number>;
  mfa_required_roles: SecuritySettingField<string[]>;
  instance_url: SecuritySettingField<string | null>;
  csp_trusted_origins: SecuritySettingField<string[]>;
}

export interface PatchSystemSettingsBody {
  session_ttl_ms?: number | null;
  operator_session_ttl_ms?: number | null;
  session_idle_timeout_ms?: number | null;
  operator_session_idle_timeout_ms?: number | null;
  trusted_device_days?: number | null;
  mfa_required_roles?: string[] | null;
  instance_url?: string | null;
  csp_trusted_origins?: string[] | null;
}

export interface RoleAssignmentDto {
  id: string;
  role: string;
  scope_type: string;
  scope_id: string | null;
  is_oidc: boolean;
}

export interface UserListItemDto {
  id: string;
  email: string;
  display_name: string | null;
  phone_country_code: string | null;
  phone_number: string | null;
  is_active: boolean;
  must_change_password: boolean;
  created_at: string;
  last_login_at: string | null;
  active_sessions_count: number;
  has_mfa: boolean;
  has_sso: boolean;
  roles: RoleAssignmentDto[];
}

export interface UserListResponse {
  users: UserListItemDto[];
  total: number;
  page: number;
  pageSize: number;
}

/** Instance-wide counts for the Users & roles KPI tiles (GET /api/admin/users/stats). */
export interface UserStatsDto {
  total: number;
  active: number;
  mfa: number;
  sso: number;
  active_sessions: number;
  active_sessions_users: number;
}

export interface CreateAdminUserBody {
  email: string;
  password: string;
  display_name?: string | null;
  phone_country_code?: string | null;
  phone_number?: string | null;
  must_change_password?: boolean;
}

export interface PatchAdminUserBody {
  is_active?: boolean;
  display_name?: string | null;
  email?: string;
  phone_country_code?: string | null;
  phone_number?: string | null;
}

export interface GrantUserRoleBody {
  role: string;
  scope_type: string;
  scope_id?: string | null;
}

export interface ResetUserPasswordBody {
  new_password: string;
}

export interface RoleAssignmentListItemDto {
  id: string;
  user_id: string;
  user_email: string;
  user_display_name: string | null;
  role: string;
  scope_type: string;
  scope_id: string | null;
  is_oidc: boolean;
  granted_at: string;
  event: {
    id: string;
    title: string;
    slug: string;
    organization_id: string;
  } | null;
  organization: {
    id: string;
    name: string;
  } | null;
}

export interface RoleAssignmentsListResponse {
  assignments: RoleAssignmentListItemDto[];
  total: number;
  page: number;
  pageSize: number;
}

export type SetupCheckKey = "database" | "redis" | "encryption" | "base_url";

export interface SetupCheckResult {
  ok: boolean;
  detail: string;
  warn?: boolean;
  /** Only set by the `database` check — distinguishes a connection failure from "connected
   * but can't confirm migrations are current" (see SystemStatus.tsx's PLAIN_DETAIL). */
  reason?: "unreachable" | "migrations_pending";
}

export interface SetupChecksResponse {
  checks: Record<SetupCheckKey, SetupCheckResult>;
}

export type HealthDetailDto = { key: string; value: string };

export type HealthCheckRowDto = {
  id: string;
  label: string;
  status: HealthRowStatus;
  summary: string;
  details: HealthDetailDto[];
};

export type HealthGroupDto = {
  id: "core" | "external";
  label: string;
  subtitle: string;
  status: HealthOverallStatus;
  checks: HealthCheckRowDto[];
};

/** GET /api/admin/health and POST /api/admin/health/live payload. */
export type HealthReportDto = {
  generated_at: string;
  version: string;
  commit: string;
  overall: HealthOverallStatus;
  groups: HealthGroupDto[];
};

export type SetupOrgBrandingDto = {
  org_name: string | null;
} & LogoPersistenceDto;

export type PatchSetupOrgBrandingBody = {
  org_name?: string;
} & Partial<LogoPersistenceDto>;

export interface SetupSupportContactDto {
  support_contact_name: string | null;
  support_contact_email: string | null;
}

export interface PatchSetupSupportContactBody {
  support_contact_name?: string;
  support_contact_email?: string;
}

/** One row from GET /api/admin/audit-log. */
export interface AuditLogEntryDto {
  id: string;
  action_type: string;
  actor_user_id: string;
  actor_email: string | null;
  actor_display_name: string | null;
  actor_timezone: string | null;
  ip: string | null;
  country: IpLocationDto;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

/** Paginated admin audit log list response. */
export interface AuditLogResponse {
  entries: AuditLogEntryDto[];
  total: number;
  page: number;
  pageSize: number;
}

/** One row from GET /api/admin/security-audit-log — durable auth/security event trail (issue
 * #473), distinct from AuditLogEntryDto's admin mutations above. No org scoping (instance-wide
 * auth events); `user_id`/`user_email`/`user_display_name` are all null for enumeration-safe
 * rows (failed logins, access-denied with no session). */
export interface SecurityAuditLogEntryDto {
  id: string;
  event_type: string;
  user_id: string | null;
  user_email: string | null;
  user_display_name: string | null;
  ip: string | null;
  country: IpLocationDto;
  /** Actor's IANA timezone at the event — null for older rows, bots, or non-browser captures. */
  actor_timezone: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

/** Paginated security audit log list response. */
export interface SecurityAuditLogResponse {
  entries: SecurityAuditLogEntryDto[];
  total: number;
  page: number;
  pageSize: number;
}

/** One row from GET /api/admin/system-logs. */
export interface SystemLogEntryDto {
  id: number;
  ts: string;
  level: "info" | "warn" | "error";
  source: "api" | "db" | "cache" | "mail" | "admin" | "security";
  message: string;
  fields?: Record<string, unknown>;
}

/** Live-tail response for the System logs panel - not paginated like the audit log; `cursor`
 * is the buffer's high-water mark, pass it back as `since` on the next poll. */
export interface SystemLogResponse {
  entries: SystemLogEntryDto[];
  cursor: number;
}

export interface AccountRoleDto {
  id: string;
  role: string;
  scope_type: string;
  scope_id: string | null;
  scope_label: string | null;
  is_oidc: boolean;
}

export interface AccountMfaMethodDto {
  type: string;
  confirmed: boolean;
  last_used_at: string | null;
}

export interface AccountExternalIdentityDto {
  id: string;
  provider_id: string;
  provider_display_name: string;
  linked_at: string;
}

export interface AccountAvailableIdentityProviderDto {
  id: string;
  display_name: string;
}

export interface AccountDto {
  id: string;
  email: string;
  display_name: string | null;
  preferred_locale: string | null;
  preferred_time_format: PreferredTimeFormat | null;
  is_active: boolean;
  must_change_password: boolean;
  has_local_password: boolean;
  phone_country_code: string | null;
  phone_number: string | null;
  roles: AccountRoleDto[];
  mfa_methods: AccountMfaMethodDto[];
  external_identities: AccountExternalIdentityDto[];
  available_identity_providers: AccountAvailableIdentityProviderDto[];
}

export interface PatchAccountProfileBody {
  display_name?: string;
  preferred_locale?: string | null;
  preferred_time_format?: PreferredTimeFormat | null;
  phone_country_code?: string | null;
  phone_number?: string | null;
}

export interface PatchAccountPasswordBody {
  current_password: string;
  new_password: string;
  new_password_confirm: string;
  code?: string;
}

export interface DeleteAccountExternalIdentityBody {
  new_password: string;
  current_password?: string;
  code?: string;
}

export interface PatchAccountPasswordResponse {
  sessions_revoked: number;
}

export interface MfaEnrollResponse {
  otpauthUri: string;
  backupCodes: string[];
  backupCodesAlreadyShown: boolean;
}

export interface ConfirmMfaTotpBody {
  code: string;
}

export interface ResetMfaBody {
  password: string;
  code?: string;
}

export interface ResetMfaResponse {
  ok: true;
  sessions_revoked: number;
}

export interface EventContactDto {
  id: string;
  name: string;
  role: string | null;
  phone: string | null;
  email: string | null;
  note: string | null;
  sort_order: number;
}

export interface EventResourceDto {
  id: string;
  title: string;
  type: "link" | "file";
  url: string;
  description: string | null;
  sort_order: number;
}

export interface EventRecentActivityEntry {
  id: string;
  type:
    | "checkin"
    | "mail_bounced"
    | "mail_failed"
    | "mail_resent"
    | "import"
    | "attendee_added"
    | "item_issued"
    | "item_returned"
    | "item_revoked";
  tone: "ok" | "warn" | "error" | "info" | "muted";
  attendee_name?: string | null;
  /** Links the entry to the attendee's detail view; null for entries with no single attendee
   * (import batches). */
  attendee_id: string | null;
  message: string;
  occurred_at: string;
}

export interface EventOverviewDto {
  event: {
    id: string;
    title: string;
    slug: string;
    date: string;
    timezone: string;
    location: string | null;
    capacity: number | null;
    archived_at: string | null;
    organization_id: string;
    pinned_note: string | null;
  };
  attendee_count: number;
  admitted_count: number;
  email_sent: number;
  email_failed: number;
  email_bounced: number;
  email_queued: number;
  requirements_count: number;
  checkin_staff_count: number;
  attendees_with_ticket: number;
  last_check_in_at: string | null;
  busiest_hour: { hour: string; count: number } | null;
  ticket_type_breakdown: Array<{ key: string; label: string; color: TicketTypeColor; count: number }>;
  recent_activity: EventRecentActivityEntry[];
  contacts: EventContactDto[];
  resources: EventResourceDto[];
}

export interface EventReportsResponse {
  timezone: string;
  event: {
    id: string;
    title: string;
    date: string;
    capacity: number | null;
  };
  summary: {
    total_attendees: number;
    admitted: number;
    no_shows: number;
    admission_rate_pct: number;
    peak_hour: string | null;
    peak_hour_count: number;
  };
  by_hour: Array<{ hour: string; count: number }>;
  /** One row per configured ticket type (catalog order), plus a trailing `key: null` "(none)"
   * row when any attendee has no type set (batch 04 / #387). */
  by_ticket_type: Array<{
    key: string | null;
    type: string;
    color: TicketTypeColor;
    total: number;
    admitted: number;
    admission_pct: number;
  }>;
  admission_log: Array<{
    attendee_id: string;
    name: string;
    email: string;
    ticket_type: string | null;
    admitted_at: string;
    /** Attendee.admitted_by, resolved - null covers the legacy/emergency bearer check-in path or
     * a row written outside the normal admit write path. */
    operator_user_id: string | null;
    operator_display_name: string | null;
    operator_email: string | null;
    /** Session.device_label at check-in time - secondary to operator_*, since it's a
     * self-declared, optional session attribute (an admin-role check-in never sets one). */
    device_id: string | null;
    items: string[];
  }>;
  admission_log_truncated: boolean;
  admission_log_total: number;
  /** Only buckets with at least one admitted attendee - zero-fill the full RsvpStatus set from
   * RSVP_LABELS' own order when rendering. `status` is a free-form String column server-side
   * (see reports-routes.ts), not narrowed to RsvpStatus - a value outside the 5 known statuses
   * is possible (legacy/orphaned data) and the renderer buckets those separately. */
  by_rsvp_status: Array<{ status: string; count: number }>;
  by_checkin_method: Array<{ method: "scan" | "manual"; count: number }>;
  /** Sorted by count descending server-side (a ranked leaderboard, not a fixed-order status set
   * like the two breakdowns above). */
  by_operator: Array<{
    operator_user_id: string | null;
    operator_display_name: string | null;
    operator_email: string | null;
    count: number;
  }>;
}

// --- Identity providers & Cloudflare Access (SPA Settings → Identity, #266) ---

export interface IdentityProviderListItem {
  id: string;
  display_name: string;
  issuer: string;
  enabled: boolean;
}

export interface IdentityProvidersListResponse {
  providers: IdentityProviderListItem[];
}

export interface ToggleProviderResponse {
  id: string;
  enabled: boolean;
}

export interface CfAccessEnvLocks {
  enabled: boolean;
  teamDomain: boolean;
  audience: boolean;
  protectedPrefixes: boolean;
}

export interface CfAccessSummaryDto {
  enabled: boolean;
  teamDomain: string;
  audience: string[];
  protectedPrefixes: string[];
  locks: CfAccessEnvLocks;
}

// --- Identity provider editor (SPA Settings → Identity, #266 slice 3) ---

export interface ProviderMappingDto {
  group: string;
  role: string;
  scope_type: string;
  scope_id: string;
}

export interface ProviderDetailDto {
  id: string;
  provider_type: string;
  display_name: string;
  issuer: string;
  client_id: string;
  has_client_secret: boolean;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  userinfo_endpoint: string | null;
  claim_email: string;
  claim_name: string;
  claim_groups: string;
  claim_given_name: string;
  claim_family_name: string;
  claim_phone: string;
  enabled: boolean;
  login_button_label: string | null;
  mappings: ProviderMappingDto[];
  /** Exact callback to register at the IdP; null when Instance URL / BASE_URL is unresolved. */
  redirect_uri: string | null;
}

/** Request body for POST/PUT /api/admin/identity/providers[/:id].
 * `mappings` is required (replace-all). `client_secret` omitted preserves the
 * stored secret on update. `login_button_label` omitted preserves; null/"" clears. */
export interface ProviderRequestBody {
  display_name: string;
  issuer: string;
  client_id: string;
  client_secret?: string;
  authorization_endpoint?: string;
  token_endpoint?: string;
  jwks_uri?: string;
  userinfo_endpoint?: string;
  claim_email?: string;
  claim_name?: string;
  claim_groups?: string;
  claim_given_name?: string;
  claim_family_name?: string;
  claim_phone?: string;
  enabled?: boolean;
  login_button_label?: string | null;
  /** Mapping shape mirrors `ProviderMappingDto` except `scope_id` is nullable on
   * the request (instance scope sends null). Derived so the two can't drift. */
  mappings: Array<Omit<ProviderMappingDto, "scope_id"> & { scope_id: string | null }>;
}

/** Discover autofill result (POST /api/admin/identity/providers/:id/discover). */
export interface DiscoverEndpointsDto {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  userinfo_endpoint: string | null;
}

export interface DiscoverResponse {
  ok: true;
  endpoints: DiscoverEndpointsDto;
  provider: ProviderDetailDto | null;
}

/** Discover preview result (POST /api/admin/identity/providers/discover-preview). */
export interface DiscoverPreviewResponse {
  ok: true;
  endpoints: DiscoverEndpointsDto;
}

/** Draft body for POST /api/admin/identity/providers/test (stateless probe). */
export interface ProviderTestDraftBody {
  issuer: string;
  authorization_endpoint?: string;
  token_endpoint?: string;
  jwks_uri?: string;
  userinfo_endpoint?: string;
}

/** Test connection result (POST /api/admin/identity/providers/:id/test). */
export interface TestResponse {
  ok: boolean;
  error?: string;
}

// --- Cloudflare Access editor (SPA Settings → Identity, #266 slice 4) ---

/** PUT /api/admin/identity/cf-access body. Every field optional (patch semantics):
 *  the server keeps the stored value for any omitted field, and overrides with the
 *  env-locked value for any locked field. Arrays accept a comma-separated string too. */
export interface CfAccessUpdateBody {
  enabled?: boolean;
  teamDomain?: string;
  audience?: string[] | string;
  protectedPrefixes?: string[] | string;
}

/** POST /api/admin/identity/cf-access/test result. */
export interface CfAccessTestResult {
  ok: boolean;
  error?: string;
}
