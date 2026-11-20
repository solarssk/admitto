import type { TabItem } from "@admitto/ui";

/** Registration page tabs, in the order they are shown. The first one is the default. */
export const REGISTRATION_TABS = [
  { id: "requests", label: "Requests" },
  { id: "fields", label: "Fields" },
  { id: "legal", label: "Legal" },
  { id: "checklist", label: "Checklist" },
] as const;

export type RegistrationTab = (typeof REGISTRATION_TABS)[number];

/** The address of a tab of the Registration page of an event, for a link from another page (Event settings). */
export function registrationTabPath(eventId: string, tab: RegistrationTab["id"]): string {
  return `/admin/events/${encodeURIComponent(eventId)}/registration?tab=${tab}`;
}

/** The open tab from `?tab=` (the address is the source of truth). A missing or unknown value opens Requests. */
export function registrationTabFromSearch(searchParams: URLSearchParams): RegistrationTab {
  const raw = searchParams.get("tab");
  return REGISTRATION_TABS.find((tab) => tab.id === raw) ?? REGISTRATION_TABS[0];
}

/** What the number on the Checklist tab says, for assistive tech. */
const stepsOpen = (count: number) => `${count} ${count === 1 ? "step" : "steps"} open`;

/** What the number on the Requests tab says, for assistive tech. */
const requestsWaiting = (count: number) => `${count} ${count === 1 ? "request waits" : "requests wait"} for a decision`;

/**
 * The tab strip. Requests carries the number of requests that wait for a decision (D-B11) and Checklist the number of steps that are
 * still open, each once it is known and more than zero.
 */
export function registrationTabItems(requestsCount?: number, openSteps?: number): TabItem[] {
  return REGISTRATION_TABS.map(({ id, label }) => {
    if (id === "checklist" && openSteps) return { id, label, count: openSteps, countLabel: stepsOpen(openSteps) };
    if (id === "requests" && requestsCount) return { id, label, count: requestsCount, countLabel: requestsWaiting(requestsCount) };
    return { id, label };
  });
}
