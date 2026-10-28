import { render, screen } from "@testing-library/react";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { RegistrationPage } from "../../src/pages/RegistrationPage.js";
import { addToast, api, refreshEvent } from "./accessApiMocks.js";
import type { RegistrationSettingsDto } from "../../src/api/types.js";
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

export const accessPanel = () => screen.getByRole("tabpanel", { name: "Access" });
export const radio = (name: string) => screen.getByRole("radio", { name });
export const toggle = (name: string) => screen.getByRole("switch", { name }) as HTMLInputElement;
export const saveButton = () => screen.getByRole("button", { name: "Save" });
export const card = (title: string) => screen.getByText(title, { selector: ".at-card__title" }).closest(".at-card") as HTMLElement;

/** Waits until the form is on screen: the placeholder draws the titles of the cards too, so a title alone is not the answer. */
export async function loaded() {
  await screen.findByRole("radiogroup", { name: "Registration mode" });
}

/** The tab with these settings, read and on screen. */
export async function renderLoaded(saved: RegistrationSettingsDto = settings(), { withEvent = event } = {}) {
  api.fetchRegistrationSettings.mockResolvedValue(saved);
  const rendered = renderAccess({ withEvent });
  await loaded();
  return rendered;
}
