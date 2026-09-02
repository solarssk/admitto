import type { LogoPersistenceDto } from "./logo-crop.js";

/** Apple PKEventType vocabulary an event can be categorized as - a WALLET_MAPPING_PLACEHOLDERS
 * entry (`event_type`), translated to the Apple literal (e.g. "PKEventTypeSports") in
 * packages/tickets/src/wallet-pass-input.ts, not sent to PassCreator on its own. */
export type EventType =
  | "generic"
  | "live_performance"
  | "movie"
  | "sports"
  | "conference"
  | "convention"
  | "workshop"
  | "social_gathering";

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
  /** Display-only 24h "HH:MM" shown on tickets/wallet passes; independently optional. */
  event_hours_start: string | null;
  event_hours_end: string | null;
  /** Optional event category; null = not set. See {@link EventType}. */
  event_type: EventType | null;
  /** Master switch for this event's wallet feature - off hides both platform buttons regardless
   * of the per-platform switches below. */
  wallet_enabled: boolean;
  /** PassCreator template for this event's wallet passes (ADR 0041); null = wallet not configured. */
  wallet_template_id: string | null;
  /** Per-event PassCreator API key - never returned in clear text. */
  wallet_api_key: { configured: boolean };
  wallet_apple_enabled: boolean;
  wallet_google_enabled: boolean;
  /** No PassCreator API support yet - toggle exists so Reports' platform breakdown can already gate
   * on it, ready for whenever PassCreator adds Samsung Wallet. */
  wallet_samsung_enabled: boolean;
  /** PassCreator field key -> Admitto placeholder token (e.g. {"name": "full_name"}). No default
   * mapping - null/empty means nothing beyond the QR code is sent to PassCreator. */
  wallet_field_mapping: Record<string, string> | null;
  capacity: number | null;
  status: "active" | "archived";
  /** Null unless status is "archived". */
  archived_at: string | null;
  /** Browser timezone of whoever archived the event, when known. */
  archived_by_timezone: string | null;
  /** When the event was first created. */
  created_at: string;
  /** Browser timezone of whoever created the event, when known. */
  created_by_timezone: string | null;
  /** True when the event has no remaining delete blockers and can be permanently deleted. */
  is_deletable: boolean;
  /**
   * Remaining reasons Delete event is disabled (empty when `is_deletable` is true).
   * Keys match the server deletability guard (attendees, custom_items, ...).
   */
  deletion_blockers: string[];
  /** Attendees currently checked in — drives the "Revoke all check-ins" Danger Zone row. */
  admitted_count: number;
  /** Individual issued/returned item hand-outs across all attendees — drives "Revoke all items issued". */
  issued_items_count: number;
  /** Active wallet passes with a confirmed device registration — drives the "this will push to N
   * installed wallet passes" confirm dialog shown before a save that touches a
   * WALLET_RELEVANT_EVENT_FIELDS field. */
  installed_wallet_pass_count: number;
  /** Every WalletPass ever issued for this event (PassCreator has actually created it, regardless
   * of install/registration status) - broader than installed_wallet_pass_count above. Drives
   * locking the Template ID field: PassCreator scopes pass lookups to one template, so a pass
   * issued under the current template becomes permanently unmanageable (sync, void/restore, push)
   * the moment the template ID changes, even if nobody ever installed it on a device. */
  issued_wallet_pass_count: number;
  organization_name: string;
  active_items: Array<{ id: string; name: string; enabled: boolean }>;
  /** Event's own branding overrides — null means "inherited from organization". */
  header_image_url: string | null;
  /** Effective branding actually used today (event value, else organization's). */
  resolved_logo_url: string | null;
  resolved_header_image_url: string | null;
} & LogoPersistenceDto;
