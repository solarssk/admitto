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
