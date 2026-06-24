export type MailerProvider = "smtp" | "graph" | "powerautomate" | "export_only";

export interface MailerStatus {
  configured: boolean;
  provider: MailerProvider | null;
}

export interface AuthUser {
  id: string;
  email: string;
  display_name: string | null;
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
  location: string | null;
  capacity: number | null;
  status: "active" | "archived";
  organization_name: string;
  active_items: Array<{ id: string; name: string; enabled: boolean }>;
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
  warnings: string[];
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

export interface AttendeeRowDto {
  id: string;
  name: string;
  email: string;
  company: string | null;
  department: string | null;
  ticket_type: string | null;
  check_in_status: "admitted" | "not_admitted";
  admitted_at: string | null;
  last_mail_status: string | null;
  rsvp_status: RsvpStatus;
}

export interface DeliveryDto {
  id: string;
  purpose: string;
  status: string;
  recipient_email: string | null;
  rendered_subject: string | null;
  queued_at: string;
  sent_at: string | null;
  failed_at: string | null;
  error_code: string | null;
}

export interface AttendeeActionLogEntryDto {
  id: string;
  action_type: string;
  actor_display: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface AttendeeDetailDto {
  id: string;
  name: string;
  email: string;
  company: string | null;
  department: string | null;
  ticket_type: string | null;
  status: string;
  check_in_status: "admitted" | "not_admitted";
  admitted_at: string | null;
  updated_at: string;
  rsvp_status: RsvpStatus;
  rsvp_updated_at: string | null;
  rsvp_source: string | null;
  ticket_ref: string | null;
  custom_data: unknown;
  deliveries: DeliveryDto[];
  action_log: AttendeeActionLogEntryDto[];
}

export interface AttendeesListResponse {
  items: AttendeeRowDto[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AttendeesListParams {
  page?: number;
  pageSize?: number;
  q?: string;
  status?: "all" | "admitted" | "not_admitted";
  ticket_type?: string;
  rsvp_status?: RsvpStatus;
}

export interface UpdateAttendeePatch {
  name?: string;
  email?: string;
  company?: string | null;
  department?: string | null;
  ticket_type?: string | null;
  custom_data_fields?: Record<string, string | null>;
  rsvp_status?: RsvpStatus;
  expected_updated_at?: string;
}

export interface ResendTicketBody {
  to?: string;
}

export interface ImportInvalidRow {
  rowIndex: number;
  reason: string;
}

export interface ImportPreviewResponse {
  importId: string;
  parse: {
    validCount: number;
    invalidRows: ImportInvalidRow[];
    warnings: string[];
  };
  summary: {
    toCreate: number;
    toUpdate: number;
    toSkip: number;
  };
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
  skipped: ImportSkippedRow[];
}

/** Admin SPA DTOs for event item configuration (mirror of web API). */
export interface EventItemContentDto {
  label: string;
  source_field: string;
}

export interface EventItemConfigDto {
  contents?: EventItemContentDto[];
  requires_return?: boolean;
  issue_on_checkin?: boolean;
}

export interface EventItemDto {
  id: string;
  key: string;
  label: string;
  type: string;
  enabled: boolean;
  config: EventItemConfigDto | null;
}

export interface EventItemsListResponse {
  items: EventItemDto[];
}

export interface CreateEventItemBody {
  key: string;
  label: string;
  config?: EventItemConfigDto;
}

export interface UpdateEventItemPatch {
  label?: string;
  enabled?: boolean;
  config?: EventItemConfigDto;
}

export interface OpsConfigDto {
  require_confirm_on_scan: boolean;
  badge_at_entry: boolean;
}

export interface UpdateOpsConfigPatch {
  require_confirm_on_scan?: boolean;
  badge_at_entry?: boolean;
}

/** Admin SPA DTOs for event mail template editing and delivery log (mirror of web API). */
export interface EventTemplateDto {
  subject_template: string;
  body_template: string;
  template_format: "mjml" | "html";
  source: "event" | "organization" | "builtin";
  allowed_placeholders: string[];
  required_url_placeholders: string[];
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

export interface TestSendResponse {
  status: "sent" | "failed";
  error?: string;
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

export interface SecuritySettingsDto {
  session_ttl_ms: SecuritySettingField<number>;
  operator_session_ttl_ms: SecuritySettingField<number>;
  trusted_device_days: SecuritySettingField<number>;
  mfa_required_roles: SecuritySettingField<string[]>;
}

export interface PatchSecuritySettingsBody {
  session_ttl_ms?: number | null;
  operator_session_ttl_ms?: number | null;
  trusted_device_days?: number | null;
  mfa_required_roles?: string[] | null;
}

export type SetupCheckKey = "database" | "migrations" | "redis" | "encryption" | "base_url";

export interface SetupCheckResult {
  ok: boolean;
  detail: string;
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
