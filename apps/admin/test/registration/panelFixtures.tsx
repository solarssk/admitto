import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { expect, vi } from "vitest";
import type { RegistrationSettingsDto } from "../../src/api/types.js";
import { EventRegistrationPanel } from "../../src/registration/EventRegistrationPanel.js";
import { isOff } from "../test-utils.js";
import { api, refreshEvent } from "./accessApiMocks.js";

export const onDirtyChange = vi.fn();
export const onSavingChange = vi.fn();

/** The return addresses of the company SSO that the panel reads beside the settings (a superadmin's route). */
export function resetPanelApi(): void {
  onDirtyChange.mockReset();
  onSavingChange.mockReset();
  api.fetchRegistrationReturnAddresses.mockResolvedValue({
    provider_id: "idp-1",
    state: "ready",
    providers: [{ id: "idp-1", display_name: "Acme Entra ID", kind: "entra" }],
    redirect_uri: null,
    redirect_uris: [],
  });
}

/** The "Registration" tab of Event settings with these settings, read and on screen. */
export async function renderPanel(saved: RegistrationSettingsDto, { archived = false, withRefresh = true } = {}) {
  api.fetchRegistrationSettings.mockResolvedValue(saved);
  render(
    <MemoryRouter>
      <EventRegistrationPanel
        eventId="evt-1"
        archived={archived}
        refreshEvent={withRefresh ? refreshEvent : undefined}
        onDirtyChange={onDirtyChange}
        onSavingChange={onSavingChange}
      />
    </MemoryRouter>,
  );
  await screen.findByText("Company SSO", { selector: ".at-card__title" });
  await waitFor(() => expect(screen.queryByLabelText("Own address")).toBeTruthy());
}

/** Save of the tab, once the address card has lifted its hold (a click before that is dropped, as it is for a person). */
export async function save() {
  await waitFor(() => expect(isOff(screen.getByRole("button", { name: "Save" }))).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(api.saveRegistrationSettings).toHaveBeenCalled());
}
