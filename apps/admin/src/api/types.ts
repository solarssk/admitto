export interface AuthUser {
  id: string;
  email: string;
  display_name: string | null;
  is_active: boolean;
  created_at: string;
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
}

export interface EventDto {
  id: string;
  title: string;
  slug: string;
  date: string;
  location: string | null;
  organization_id: string;
  attendee_count?: number;
}

export interface BrandingThemeDto {
  primary?: string;
  font_family_url?: string;
  font_family_name?: string;
}

export interface ThemeResponse {
  theme: BrandingThemeDto;
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
  shirt_size: string | null;
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
}

export interface AttendeeRowDto {
  id: string;
  name: string;
  email: string;
  company: string | null;
  ticket_type: string | null;
  check_in_status: "admitted" | "not_admitted";
  last_mail_status: string | null;
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
  shirt_size: string | null;
  custom_data: unknown;
  deliveries: DeliveryDto[];
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
}

export interface UpdateAttendeePatch {
  name?: string;
  email?: string;
  company?: string | null;
  department?: string | null;
  ticket_type?: string | null;
  shirt_size?: string | null;
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

export interface EventDeliveriesListParams {
  page?: number;
  pageSize?: number;
  status?: "all" | "queued" | "accepted" | "sent" | "delivered" | "failed" | "bounced" | "rejected";
}

export interface EventDeliveriesListResponse {
  items: DeliveryDto[];
  total: number;
  page: number;
  pageSize: number;
}
