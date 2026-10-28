import { render } from "@testing-library/react";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { RegistrationPage } from "../../src/pages/RegistrationPage.js";
import { addToast, api, refreshEvent } from "./accessApiMocks.js";
import { event, legalAnswer, settings, texts } from "./accessData.js";

/** Puts the first reads in their usual state: a ready event with a photo consent that is published. */
export function resetApi(): void {
  for (const call of Object.values(api)) call.mockReset();
  addToast.mockReset();
  refreshEvent.mockReset();
  refreshEvent.mockResolvedValue(undefined);
  api.fetchRegistrationSettings.mockResolvedValue(settings());
  api.fetchLegalDocuments.mockResolvedValue(legalAnswer(texts(["photo", "Photos and video", true], ["news", "News about our events", false])));
  api.fetchRegistrationCounts.mockResolvedValue({ mode: null, by_status: { awaiting_email: 0, pending: 0, waitlist: 0, accepted: 0, rejected: 0 }, needs_decision: 0 });
}

/** The Registration page on its Access tab, in the frame every page of an event has (the event is in the outlet context). */
export function renderAccess({ withEvent = event, path = "/admin/events/evt-1/registration?tab=access" } = {}) {
  const router = createMemoryRouter(
    [
      {
        element: <Outlet context={{ event: withEvent, refreshEvent }} />,
        children: [
          { path: "/admin/events/:eventId/registration", element: <RegistrationPage /> },
          { path: "/admin/registration", element: <RegistrationPage /> },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return { router };
}
