/** My Account tab ids - Profile / Password (incl. two-factor) / Sessions / Notifications. */
export type AccountTab = "profile" | "password" | "sessions" | "notifications";

export const ACCOUNT_TABS = [
  { id: "profile", label: "Profile" },
  { id: "password", label: "Password" },
  { id: "sessions", label: "Sessions" },
  { id: "notifications", label: "Notifications" },
] as const;

export function isAccountTab(id: string): id is AccountTab {
  return ACCOUNT_TABS.some((tab) => tab.id === id);
}

/** Resolve the active in-page tab from `?tab=` (URL is the source of truth; defaults to "profile"). */
export function inPageTabFromSearch(searchParams: URLSearchParams): AccountTab {
  const raw = searchParams.get("tab");
  if (raw && isAccountTab(raw)) return raw;
  return "profile";
}
