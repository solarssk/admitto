import { pluralize } from "./pluralize.js";

/** "12 guests and 2 companions": the people on site, split into the guests who came in and the companions who came in with them. */
export function peopleOnSiteBreakdown(guests: number, companions: number): string {
  return `${guests} ${pluralize(guests, "guest")} and ${companions} ${pluralize(companions, "companion")}`;
}
