import { render, screen, within } from "@testing-library/react";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { ToastProvider } from "@admitto/ui";
import type { EventDto } from "../../src/api/types.js";
import { RegistrationPage } from "../../src/pages/RegistrationPage.js";
import { EVENT } from "./requestsData.js";

/**
 * What the tests of the Requests tab share: the page as the app has it (the event and its refresh in the outlet context of the layout)
 * and how to find things in it. The data is in requestsData.ts, and the mocks of the API are each test file's own (a `vi.mock` only
 * works where it is written; requestsApi.tsx has the handles).
 */
export { EVENT, FAILED_MAIL, answer, counts, detail, mailRow, named, request } from "./requestsData.js";

export interface RenderTabOptions {
  search?: string;
  path?: string;
  event?: EventDto;
  /** What the layout gives the page to read the event again; left out, the page has none (as in a test of another page). */
  refreshEvent?: () => Promise<unknown>;
}

/** The Registration page on the route of an event, with the event (and its refresh) in the outlet context as the layout gives them. */
export function renderTab({ search = "?tab=requests", path = "/admin/events/evt-1/registration", event = EVENT, refreshEvent }: RenderTabOptions = {}) {
  const router = createMemoryRouter(
    [
      {
        element: <Outlet context={{ event, refreshEvent }} />,
        children: [
          { path: "/admin/events/:eventId/registration", element: <RegistrationPage /> },
          { path: "/admin/registration", element: <RegistrationPage /> },
          { path: "/admin/events/:eventId/attendees/:attendeeId", element: <p>The attendee page</p> },
        ],
      },
    ],
    { initialEntries: [`${path}${search}`] },
  );
  render(
    <ToastProvider>
      <RouterProvider router={router} />
    </ToastProvider>,
  );
  return { router };
}

export const requestsPanel = () => screen.getByRole("tabpanel", { name: "Requests" });
export const table = () => within(requestsPanel()).getByRole("table", { name: "Requests" });
export const bodyRows = () => within(table()).getAllByRole("row").slice(1);
export const guestNames = () => bodyRows().map((row) => row.querySelector(".registration-requests__name")?.textContent);
/** The button that opens the request of this id, which is also where the keyboard goes. */
export const openButton = (id: string) => requestsPanel().querySelector<HTMLElement>(`[data-request-open="${id}"]`);
/** The ids of the requests on the page, in order. */
export const openIds = () => [...requestsPanel().querySelectorAll<HTMLElement>("[data-request-open]")].map((button) => button.dataset.requestOpen);
export const cardPanel = () => requestsPanel().querySelector<HTMLElement>(".registration-requests__panel");
