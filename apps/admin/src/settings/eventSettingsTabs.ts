/** Event Settings tab ids — General/Ticket types/Branding/Wallet/Integrations/Danger zone
 * (single in-page tab row, no nested routes). */
export type EventSettingsTab =
  | "general"
  | "ticket-types"
  | "branding"
  | "mail"
  | "wallet"
  | "integrations"
  | "danger-zone";

export const EVENT_SETTINGS_TABS = [
  { id: "general", label: "General" },
  { id: "ticket-types", label: "Ticket types" },
  { id: "branding", label: "Branding" },
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
export function inPageTabFromSearch(searchParams: URLSearchParams, isSuperadmin: boolean): EventSettingsTab {
  const raw = searchParams.get("tab");
  if (raw && isEventSettingsTab(raw) && (isSuperadmin || !SUPERADMIN_ONLY_TABS.has(raw))) return raw;
  return "general";
}
