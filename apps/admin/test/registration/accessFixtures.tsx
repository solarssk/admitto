import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, vi } from "vitest";
import { ToastProvider } from "@admitto/ui";
import { createMemoryRouter, Outlet, RouterProvider, useOutletContext, useParams } from "react-router";
import { RegistrationPage } from "../../src/pages/RegistrationPage.js";
import { EventRegistrationPanel } from "../../src/registration/EventRegistrationPanel.js";
import { addToast, api, refreshEvent } from "./accessApiMocks.js";
import type { RegistrationSettingsDto } from "../../src/api/types.js";
import { setViewport } from "../test-utils.js";
import { event, legalAnswer, settings, texts } from "./accessData.js";

/** Puts the first reads in their usual state: a ready event with a photo consent that is published. */
export function resetApi(): void {
  setViewport(true);
  for (const call of Object.values(api)) call.mockReset();
  addToast.mockReset();
  refreshEvent.mockReset();
  refreshEvent.mockResolvedValue(undefined);
  api.fetchRegistrationSettings.mockResolvedValue(settings());
  api.fetchLegalDocuments.mockResolvedValue(legalAnswer(texts(["photo", "Photos and video", true], ["news", "News about our events", false])));
  api.fetchRegistrationCounts.mockResolvedValue({ mode: null, by_status: { awaiting_email: 0, pending: 0, waitlist: 0, accepted: 0, rejected: 0 }, needs_decision: 0 });
}

/** The Registration page, in the frame every page of an event has (the event is in the outlet context). */
export function renderPage({ withEvent = event, path = "/admin/events/evt-1/registration" } = {}) {
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
  render(
    <ToastProvider>
      <RouterProvider router={router} />
    </ToastProvider>,
  );
  return { router };
}

export const onDirtyChange = vi.fn();
export const onSavingChange = vi.fn();

/** What the page of Event settings makes of the Registration tab: the panel for the event of the address, as a superadmin or not. */
function SettingsRegistration({ superadmin }: Readonly<{ superadmin: boolean }>) {
  const { eventId } = useParams();
  const { event: current } = useOutletContext<{ event: typeof event }>();
  return (
    <EventRegistrationPanel
      eventId={eventId ?? ""}
      archived={current.archived_at !== null}
      superadmin={superadmin}
      refreshEvent={refreshEvent}
      onDirtyChange={onDirtyChange}
      onSavingChange={onSavingChange}
    />
  );
}

/** The Registration tab of Event settings, in the frame every page of an event has. A superadmin by default. */
export function renderAccess({ withEvent = event, path = "/admin/events/evt-1/settings?tab=registration", superadmin = true } = {}) {
  const router = createMemoryRouter(
    [
      {
        element: <Outlet context={{ event: withEvent, refreshEvent }} />,
        children: [
          { path: "/admin/events/:eventId/settings", element: <SettingsRegistration superadmin={superadmin} /> },
          { path: "/admin/events/:eventId/registration", element: <RegistrationPage /> },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return { router };
}

export const radio = (name: string) => screen.getByRole("radio", { name });
export const toggle = (name: string) => screen.getByRole("switch", { name }) as HTMLInputElement;
export const saveButton = () => screen.getByRole("button", { name: "Save" });
export const card = (title: string) => screen.getByText(title, { selector: ".at-card__title" }).closest(".at-card") as HTMLElement;

/** Waits until the form is on screen: the placeholder draws the titles of the cards too, so a title alone is not the answer. */
export async function loaded() {
  await screen.findByRole("switch", { name: "Waiting list" });
}

/** The Registration tab of Event settings with these settings, read and on screen. */
export async function renderLoaded(saved: RegistrationSettingsDto = settings(), { withEvent = event, superadmin = true } = {}) {
  api.fetchRegistrationSettings.mockResolvedValue(saved);
  const rendered = renderAccess({ withEvent, superadmin });
  await loaded();
  return rendered;
}

/** The Registration page on its Checklist tab. */
export function renderChecklist({ withEvent = event, path = "/admin/events/evt-1/registration?tab=checklist" } = {}) {
  return renderPage({ withEvent, path });
}

export const checklistPanel = () => screen.getByRole("tabpanel", { name: "Checklist" });
/** Every row of the checklist that can be seen, in the order of the page, whichever card it is in (what is in a closed Done is inert, and not among them). */
export const checklistRows = () => Array.from(checklistPanel().querySelectorAll<HTMLElement>("li.access-check")).filter((row) => !row.closest("[inert]"));

/** Opens the card Done, which is closed until it is opened: its rows are then among the rows of the checklist. */
export function openDone() {
  fireEvent.click(doneSummary());
}

/** The header of the card Done. */
export const doneSummary = () => within(checklistPanel()).getByRole("button", { name: /^Done/ });

/** Waits until the checklist is on screen: the placeholder draws the titles of the cards too, so a title alone is not the answer. */
export async function checklistLoaded() {
  await waitFor(() => {
    expect(screen.queryByRole("status", { name: "Loading the checklist" })).toBeNull();
    expect(screen.getByText("Registration checklist", { selector: ".at-card__title" })).toBeTruthy();
  });
}

/** The checklist with these settings, read and on screen. */
export async function renderChecklistLoaded(saved: RegistrationSettingsDto = settings(), { withEvent = event } = {}) {
  api.fetchRegistrationSettings.mockResolvedValue(saved);
  const rendered = renderChecklist({ withEvent });
  await checklistLoaded();
  return rendered;
}
