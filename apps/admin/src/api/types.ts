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
