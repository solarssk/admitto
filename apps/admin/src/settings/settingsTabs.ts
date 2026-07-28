/** Shared Settings tab ids for the instance settings shell (#266 slice 7b). */
export type SettingsTab = "general" | "mail" | "security" | "archiving" | "identity" | "logs";

export const SETTINGS_TABS = [
  { id: "general", label: "General" },
  { id: "mail", label: "Mail" },
  { id: "security", label: "Security" },
  { id: "archiving", label: "Archiving" },
  { id: "identity", label: "Identity" },
  { id: "logs", label: "Logs" },
] as const;

export const SETTINGS_INDEX_PATH = "/admin/settings";

export function isSettingsTab(id: string): id is SettingsTab {
  return SETTINGS_TABS.some((tab) => tab.id === id);
}

/** True for `/admin/settings/identity` and all nested identity routes. */
export function isIdentitySettingsPath(pathname: string): boolean {
  return (
    pathname === `${SETTINGS_INDEX_PATH}/identity` ||
    pathname.startsWith(`${SETTINGS_INDEX_PATH}/identity/`)
  );
}

/** Resolve the active in-page tab from `?tab=` (never returns `identity`). */
export function inPageTabFromSearch(searchParams: URLSearchParams): Exclude<SettingsTab, "identity"> {
  const raw = searchParams.get("tab");
  if (raw && raw !== "identity" && isSettingsTab(raw)) return raw as Exclude<SettingsTab, "identity">;
  return "general";
}
