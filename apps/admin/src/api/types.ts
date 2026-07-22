export type MailerProvider = "smtp" | "graph" | "powerautomate" | "export_only";

export interface MailerStatus {
  configured: boolean;
  provider: MailerProvider | null;
}

export interface AuthUser {
  id: string;
  email: string;
  display_name: string | null;
  preferred_locale?: string | null;
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
  location: string | null;
  organization_id: string;
  attendee_count?: number;
  archived_at: string | null;
}

export interface EventSettingsDto {
  id: string;
  title: string;
  slug: string;
  date: string;
  timezone: string;
  location: string | null;
  capacity: number | null;
  status: "active" | "archived";
  /** Null unless status is "archived". */
  archived_at: string | null;
  /** When the event was first created. */
  created_at: string;
  /** True when the event has zero real activity and can be permanently deleted. */
  is_deletable: boolean;
  /** Attendees currently checked in — drives the "Revoke all check-ins" Danger Zone row. */
  admitted_count: number;
  /** Individual issued/returned item hand-outs across all attendees — drives "Revoke all items issued". */
  issued_items_count: number;
  organization_name: string;
  active_items: Array<{ id: string; name: string; enabled: boolean }>;
  /** Event's own branding overrides — null means "inherited from organization". */
  logo_url: string | null;
  header_image_url: string | null;
  /** Effective branding actually used today (event value, else organization's). */
  resolved_logo_url: string | null;
  resolved_header_image_url: string | null;
}

export interface BrandingThemeDto {
  primary?: string;
  font_family_url?: string;
  font_family_name?: string;
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

export interface DeliveryDto {
  id: string;
  purpose: string;
  status: string;
  recipient_email: string | null;
  rendered_subject: string | null;
  queued_at: string;
  accepted_at: string | null;
  sent_at: string | null;
  failed_at: string | null;
  error_code: string | null;
  /** Triggering admin's IANA timezone at send time, when known. */
  client_timezone: string | null;
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

export interface AttendeeDetailDto {
  id: string;
  name: string;
  email: string;
  company: string | null;
  department: string | null;
  ticket_type: string | null;
  status: AttendeeStatus;
  check_in_status: "admitted" | "not_admitted";
  admitted_at: string | null;
  created_at: string;
  /** Acting admin's IANA timezone at attendee-creation time, when known (manual add / import). */
  client_timezone: string | null;
  updated_at: string;
  rsvp_status: RsvpStatus;
  rsvp_updated_at: string | null;
  rsvp_source: string | null;
  ticket_ref: string | null;
  custom_data: unknown;
  deliveries: DeliveryDto[];
  action_log: AttendeeActionLogEntryDto[];
  event_items: AttendeeDetailItemDto[];
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
  name?: string;
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
  /** Capped server-side; toSkip above is the true total. */
  skipped: ImportSkippedRow[];
  /** Rows dropped by the commit-time re-parse before ever reaching the write step (e.g. a ticket
   * type deleted from the catalog between preview and commit) - absent from created/updated/skipped.
   * Capped server-side; invalidCount is the true total. */
  invalidRows: ImportInvalidRow[];
  invalidCount: number;
}

/** Bulk ticket send queue summary from POST .../attendees/bulk-resend. */
export interface BulkResendResponse {
  /** Deliveries accepted by the mail provider. */
  queued: number;
  skipped: number;
  /** Delivery rows created but not accepted by the provider. */
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
}

export interface SaveTemplateBody {
  subject_template: string;
  body_template: string;
  template_format: "mjml" | "html";
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
export type MailTransportTestSendResponse =
  | { status: "sent"; provider: MailProvider; providerMessageId?: string }
  | { status: "failed"; error: string; provider?: MailProvider; retryable?: boolean };

/** Multi-template list item from GET .../templates. */
export interface MailTemplateListItem {
  id: string;
  name: string;
  label: string;
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
  fields: MailSettingsFieldsDto;
}

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
}

export interface EventDeliveriesListResponse {
  items: DeliveryDto[];
  total: number;
  page: number;
  pageSize: number;
}

export type SessionRole = "superadmin" | "admin" | "operator";
export type SettingSource = "env" | "db" | "default";

export interface SessionListDto {
  id: string;
  userId: string;
  userEmail: string;
  userDisplayName: string | null;
  role: SessionRole;
  deviceLabel: string | null;
  ip: string | null;
  userAgent: string | null;
  loginAt: string;
  lastSeenAt: string;
  expiresAt: string;
  authMethod: string;
  stage: string;
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
  trusted_device_days: SecuritySettingField<number>;
  mfa_required_roles: SecuritySettingField<string[]>;
  instance_url: SecuritySettingField<string | null>;
}

export interface PatchSystemSettingsBody {
  session_ttl_ms?: number | null;
  operator_session_ttl_ms?: number | null;
  trusted_device_days?: number | null;
  mfa_required_roles?: string[] | null;
  instance_url?: string | null;
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
  is_active: boolean;
  must_change_password: boolean;
  created_at: string;
  last_login_at: string | null;
  active_sessions_count: number;
  has_mfa: boolean;
  roles: RoleAssignmentDto[];
}

export interface UserListResponse {
  users: UserListItemDto[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreateAdminUserBody {
  email: string;
  password: string;
  display_name?: string | null;
  must_change_password?: boolean;
}

export interface PatchAdminUserBody {
  is_active?: boolean;
  display_name?: string | null;
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
}

export interface SetupChecksResponse {
  checks: Record<SetupCheckKey, SetupCheckResult>;
}

export interface SetupOrgBrandingDto {
  org_name: string | null;
  logo_url: string | null;
}

export interface PatchSetupOrgBrandingBody {
  org_name?: string;
  logo_url?: string | null;
}

/** One row from GET /api/admin/audit-log. */
export interface AuditLogEntryDto {
  id: string;
  action_type: string;
  actor_user_id: string;
  actor_email: string | null;
  actor_display_name: string | null;
  ip: string | null;
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

export interface AccountRoleDto {
  id: string;
  role: string;
  scope_type: string;
  scope_id: string | null;
  is_oidc: boolean;
}

export interface AccountMfaMethodDto {
  type: string;
  confirmed: boolean;
  last_used_at: string | null;
}

export interface AccountDto {
  id: string;
  email: string;
  display_name: string | null;
  preferred_locale: string | null;
  is_active: boolean;
  must_change_password: boolean;
  has_local_password: boolean;
  roles: AccountRoleDto[];
  mfa_methods: AccountMfaMethodDto[];
}

export interface PatchAccountProfileBody {
  display_name?: string;
  preferred_locale?: string | null;
}

export interface PatchAccountPasswordBody {
  current_password: string;
  new_password: string;
  new_password_confirm: string;
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
  type: "checkin" | "mail_bounced" | "mail_failed" | "mail_resent" | "import";
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
    device_id: string | null;
  }>;
  admission_log_truncated: boolean;
  admission_log_total: number;
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
  enabled: boolean;
  login_button_label: string | null;
  mappings: ProviderMappingDto[];
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
