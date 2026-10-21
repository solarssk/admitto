import type { TabItem } from "@admitto/ui";

/** Registration page tabs, in the order they are shown. The first one is the default. */
export const REGISTRATION_TABS = [
  { id: "requests", label: "Requests" },
  { id: "fields", label: "Fields" },
  { id: "access", label: "Access" },
] as const;

export type RegistrationTab = (typeof REGISTRATION_TABS)[number];

/** The open tab from `?tab=` (the address is the source of truth). A missing or unknown value opens Requests. */
export function registrationTabFromSearch(searchParams: URLSearchParams): RegistrationTab {
  const raw = searchParams.get("tab");
  return REGISTRATION_TABS.find((tab) => tab.id === raw) ?? REGISTRATION_TABS[0];
}

/** The tab strip. Requests carries the number of requests that wait for a decision (D-B11) once it is known. */
export function registrationTabItems(requestsCount?: number): TabItem[] {
  return REGISTRATION_TABS.map(({ id, label }) => ({
    id,
    label,
    count: id === "requests" ? requestsCount : undefined,
  }));
}
