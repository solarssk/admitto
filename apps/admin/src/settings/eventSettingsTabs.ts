/** Event Settings tab ids — General/Ticket types/Images/Wallet/Integrations/Danger zone
 * (single in-page tab row, no nested routes). */
export type EventSettingsTab =
  | "general"
  | "ticket-types"
  | "images"
  | "mail"
  | "wallet"
  | "integrations"
  | "danger-zone";

export const EVENT_SETTINGS_TABS = [
  { id: "general", label: "General" },
  { id: "ticket-types", label: "Ticket types" },
  { id: "images", label: "Images" },
  { id: "mail", label: "Mailing" },
  { id: "wallet", label: "Wallet" },
  { id: "integrations", label: "Integrations" },
  { id: "danger-zone", label: "Danger zone" },
] as const;

/** Tabs whose contents are superadmin-only (technical/API concerns kept out of non-technical org-admin view). */
export const SUPERADMIN_ONLY_TABS: ReadonlySet<EventSettingsTab> = new Set(["mail", "integrations"]);

export function isEventSettingsTab(id: string): id is EventSettingsTab {
  return EVENT_SETTINGS_TABS.some((tab) => tab.id === id);
}

/** Resolve the active in-page tab from `?tab=` (URL is the source of truth; defaults to "general").
 * Falls back to "general" for superadmin-only tabs when the caller isn't a superadmin — guards
 * against reaching a restricted tab via direct URL manipulation, not just hiding its tab button. */
// "branding" was this tab's id before it was renamed to "images" - kept as an alias so an
// existing bookmark or link still lands on the right tab instead of silently falling back to
// General.
const LEGACY_TAB_ALIASES: Readonly<Record<string, EventSettingsTab>> = { branding: "images" };

export function inPageTabFromSearch(searchParams: URLSearchParams, isSuperadmin: boolean): EventSettingsTab {
  const raw = searchParams.get("tab");
  const resolved = (raw && LEGACY_TAB_ALIASES[raw]) || raw;
  if (resolved && isEventSettingsTab(resolved) && (isSuperadmin || !SUPERADMIN_ONLY_TABS.has(resolved))) {
    return resolved;
  }
  return "general";
}
