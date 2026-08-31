// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { getTooltipText } from "../test-utils.js";
import { fetchEventAttendees, fetchEventMailSettings, mailSettings, makeRow, renderPage } from "./attendeesPageSetup.js";

beforeEach(() => {
  fetchEventAttendees.mockResolvedValue({
    items: [makeRow("att-1", "Jane Doe")],
    total: 1,
    page: 1,
    pageSize: 25,
  });
});

describe("AttendeesPage header Send tickets — mail-configured gate", () => {
  it("disables Send tickets with an explanatory tooltip when neither the event nor the org has a mail transport", async () => {
    fetchEventMailSettings.mockResolvedValue(mailSettings(null));
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "More actions" }));
    const sendTicketsItem = await screen.findByRole("menuitem", { name: /^Send tickets/ });

    await waitFor(() => expect(sendTicketsItem.disabled).toBe(true));
    expect(getTooltipText(sendTicketsItem)).toMatch(/no mail transport configured/i);
  });

  it("keeps Send tickets enabled when a real transport (smtp/graph/powerautomate) resolves, inherited or dedicated", async () => {
    fetchEventMailSettings.mockResolvedValue(mailSettings("graph"));
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "More actions" }));
    const sendTicketsItem = await screen.findByRole("menuitem", { name: /^Send tickets/ });
    await waitFor(() => expect(fetchEventMailSettings).toHaveBeenCalled());
    expect(sendTicketsItem.disabled).toBe(false);
  });

  it('treats "export_only" as not actually configured, same as EventMailSettingsCard\'s own check', async () => {
    fetchEventMailSettings.mockResolvedValue(mailSettings("export_only"));
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "More actions" }));
    const sendTicketsItem = await screen.findByRole("menuitem", { name: /^Send tickets/ });
    await waitFor(() => expect(sendTicketsItem.disabled).toBe(true));
  });

  it("does not block the button while the mail-settings fetch is still pending or if it fails (fails open)", async () => {
    fetchEventMailSettings.mockRejectedValue(new Error("network down"));
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "More actions" }));
    const sendTicketsItem = await screen.findByRole("menuitem", { name: /^Send tickets/ });
    await waitFor(() => expect(fetchEventMailSettings).toHaveBeenCalled());
    expect(sendTicketsItem.disabled).toBe(false);
  });
});
