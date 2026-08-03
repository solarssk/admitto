import type { LogoPersistenceDto } from "./logo-crop.js";

/**
 * GET /api/admin/events/:id settings payload (server + admin SPA).
 * Kept in mail-templates next to {@link LogoPersistenceDto} so web and admin share one shape.
 */
export type EventSettingsDto = {
  id: string;
  title: string;
  slug: string;
  date: string;
  timezone: string;
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
  header_image_url: string | null;
  /** Effective branding actually used today (event value, else organization's). */
  resolved_logo_url: string | null;
  resolved_header_image_url: string | null;
} & LogoPersistenceDto;
