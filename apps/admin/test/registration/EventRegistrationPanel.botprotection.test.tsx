// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import axe from "axe-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/api/client.js";
import { getTooltipText, isOff } from "../test-utils.js";
import { api } from "./accessApiMocks.js";
import { settings, ssoEventSettings } from "./accessData.js";
import { resetApi, saveButton } from "./accessFixtures.js";
import { renderPanel, resetPanelApi } from "./panelFixtures.js";

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const { api: mocks } = await import("./accessApiMocks.js");
  return {
    ...(await importOriginal<typeof import("../../src/api/client.js")>()),
    fetchRegistrationSettings: (...args: unknown[]) => mocks.fetchRegistrationSettings(...args),
    saveRegistrationSettings: (...args: unknown[]) => mocks.saveRegistrationSettings(...args),
    fetchRegistrationReturnAddresses: (...args: unknown[]) => mocks.fetchRegistrationReturnAddresses(...args),
    saveCustomDomain: (...args: unknown[]) => mocks.saveCustomDomain(...args),
    checkCustomDomain: (...args: unknown[]) => mocks.checkCustomDomain(...args),
  };
});
vi.mock("../../src/connection/ConnectionStateProvider.js");
vi.mock("../../src/auth/login-navigation.js", () => ({ goToLogin: vi.fn() }));
vi.mock("@admitto/ui", async (importOriginal) => {
  const { addToast: toast } = await import("./accessApiMocks.js");
  return { ...(await importOriginal<typeof import("@admitto/ui")>()), useToast: () => ({ addToast: toast }) };
});

const botSwitch = () => document.getElementById("event-bot-protection-enabled") as HTMLInputElement;
const botCard = () => botSwitch().closest(".at-card") as HTMLElement;
/** The part of the Access method card that is about the bot check: its row and what it says. */
const botArea = () => botSwitch().closest(".access-bot") as HTMLElement;

beforeEach(() => {
  resetApi();
  resetPanelApi();
});

afterEach(() => {
  cleanup();
});

describe("the bot protection card of an event, in Event settings", () => {
  it("stays while the organisation's own switch is off, with the switch shown Off and greyed, a tooltip that says why, and nothing else added", async () => {
    await renderPanel(settings({ bot_protection: "not_used", bot_protection_enabled: true }));

    expect(botSwitch().checked).toBe(false);
    expect(botSwitch().disabled).toBe(true);
    expect(within(botArea()).getByText("Off")).toBeTruthy();
    expect(getTooltipText(botSwitch())).toBe("Bot protection is turned off for the whole organisation.");
    const note = document.getElementById(botSwitch().getAttribute("aria-describedby") ?? "none");
    expect(note?.textContent).toBe("Bot protection is turned off for the whole organisation.");
    expect(note?.className).toBe("sr-only");
    expect(within(botArea()).getByText("Asks a visitor to prove they are not a bot before the form is sent. Used on the link and password forms of this event.")).toBeTruthy();
    expect(botArea().querySelector(".at-notice")).toBeNull();
    fireEvent.click(botSwitch());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(isOff(saveButton())).toBe(true);
  });

  it("sends nothing about the switch while the organisation's is off, and leaves the value stored for the event as it is", async () => {
    await renderPanel(settings({ bot_protection: "not_used", bot_protection_enabled: false }));
    // The event's own value is Off too, and still no notice: the organisation's switch is what counts, and the card says nothing more.
    expect(botArea().querySelector(".at-notice")).toBeNull();
    api.saveRegistrationSettings.mockResolvedValue(settings({ bot_protection: "not_used", bot_protection_enabled: false, access_methods: ["password"] }));

    fireEvent.click(screen.getByRole("radio", { name: "Password" }));
    fireEvent.click(saveButton());

    await waitFor(() => expect(api.saveRegistrationSettings).toHaveBeenCalledWith("evt-1", { access_methods: ["password"], expected_sso_provider_id: null }));
  });

  it("is a row inside the Access method card, under the notice of the method, in the pattern of the switch rows of the Form card, and not a card of its own", async () => {
    await renderPanel(settings());

    expect(botCard().querySelector(".at-card__title")?.textContent).toBe("Access method");
    expect(screen.queryByText("Bot protection", { selector: ".at-card__title" })).toBeNull();
    const row = botArea().querySelector(".settings-row.settings-row--switch") as HTMLElement;
    expect(row.querySelector(".settings-row__text strong")?.textContent?.trim()).toBe("Bot protection");
    expect(row.querySelector(".settings-row__text p")).not.toBeNull();
    const stack = botCard().querySelector(".settings-card-stack") as HTMLElement;
    const children = [...stack.children];
    expect(children.at(-1)).toBe(botArea());
    expect(children.findIndex((child) => child.classList.contains("at-notice"))).toBeLessThan(children.indexOf(botArea()));
  });

  it("is there, On by default, with what the check does, while the organisation's switch is on", async () => {
    await renderPanel(settings());

    expect(botSwitch().checked).toBe(true);
    expect(within(botArea()).getByText("On")).toBeTruthy();
    expect(within(botArea()).getByText("Asks a visitor to prove they are not a bot before the form is sent. Used on the link and password forms of this event.")).toBeTruthy();
    expect(botArea().querySelector(".at-notice")).toBeNull();
    expect(isOff(saveButton())).toBe(true);
  });

  it("shows Off with a plain risk sentence for an event that switched it off", async () => {
    await renderPanel(settings({ bot_protection_enabled: false }));

    expect(botSwitch().checked).toBe(false);
    expect(within(botArea()).getByText("Off")).toBeTruthy();
    expect(botArea().querySelector(".at-notice--warning")?.textContent).toBe("Without the check, bots can fill in the form. The link and password forms of this event have no bot check.");
  });

  it("asks first when it is turned off, with the confirm as the primary button, and changes nothing until the person confirms", async () => {
    await renderPanel(settings());

    fireEvent.click(botSwitch());
    const dialog = await screen.findByRole("dialog", { name: "Turn bot protection off for this event?" });

    expect(dialog.textContent).toContain("guests of this event are not checked for bots");
    const confirm = within(dialog).getByRole("button", { name: "Turn off" });
    expect(confirm.className).toContain("at-btn--primary");
    expect(botSwitch().checked).toBe(true);
    expect(isOff(saveButton())).toBe(true);

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(botSwitch().checked).toBe(true);

    fireEvent.click(botSwitch());
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Turn off" }));
    expect(botSwitch().checked).toBe(false);
    expect(isOff(saveButton())).toBe(false);
  });

  it("is turned on with no question, and Reset takes it back", async () => {
    await renderPanel(settings({ bot_protection_enabled: false }));

    fireEvent.click(botSwitch());

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(botSwitch().checked).toBe(true);
    expect(isOff(saveButton())).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(botSwitch().checked).toBe(false);
  });

  it("sends the switch in the one Save of the tab, together with the other technical settings, and nothing about it when it did not change", async () => {
    await renderPanel(settings());
    api.saveRegistrationSettings.mockResolvedValue(settings({ bot_protection_enabled: false, access_methods: ["password"] }));

    fireEvent.click(botSwitch());
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Turn off" }));
    fireEvent.click(screen.getByRole("radio", { name: "Password" }));
    fireEvent.click(saveButton());

    await waitFor(() => expect(api.saveRegistrationSettings).toHaveBeenCalledWith("evt-1", { access_methods: ["password"], bot_protection_enabled: false, expected_sso_provider_id: null }));
    await waitFor(() => expect(isOff(saveButton())).toBe(true));
    expect(botSwitch().checked).toBe(false);

    api.saveRegistrationSettings.mockClear();
    api.saveRegistrationSettings.mockResolvedValue(settings({ bot_protection_enabled: false, access_methods: ["link"] }));
    fireEvent.click(screen.getByRole("radio", { name: "Link" }));
    fireEvent.click(saveButton());
    await waitFor(() => expect(api.saveRegistrationSettings).toHaveBeenCalledWith("evt-1", { access_methods: ["link"], expected_sso_provider_id: null }));
  });

  it("is greyed for an event that uses Company SSO, with one sentence that says why, and keeps its value", async () => {
    await renderPanel(ssoEventSettings({ bot_protection_enabled: false }));

    expect(botSwitch().disabled).toBe(true);
    expect(botSwitch().checked).toBe(false);
    expect(botArea().querySelector(".at-notice--info")?.textContent).toContain("Company SSO, which does not use the bot check");
    expect(botArea().querySelector(".at-notice--warning")).toBeNull();
  });

  it("follows the access method in the form: greyed as soon as Company SSO is chosen, offered again for the link", async () => {
    await renderPanel(settings());

    fireEvent.click(screen.getByRole("radio", { name: "Company SSO" }));
    expect(botSwitch().disabled).toBe(true);

    fireEvent.click(screen.getByRole("radio", { name: "Link" }));
    expect(botSwitch().disabled).toBe(false);
  });

  it("is locked while a save runs, and for an archived event", async () => {
    await renderPanel(settings({ bot_protection_enabled: false }), { archived: true });
    expect(botSwitch().disabled).toBe(true);
    cleanup();

    await renderPanel(settings({ bot_protection_enabled: false }));
    let finish: (value: unknown) => void = () => undefined;
    api.saveRegistrationSettings.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    fireEvent.click(botSwitch());
    fireEvent.click(saveButton());
    await waitFor(() => expect(api.saveRegistrationSettings).toHaveBeenCalled());
    expect(botSwitch().disabled).toBe(true);
    finish(settings());
  });

  it("says why a save is refused to somebody who may not change it: 403 `bot_protection_superadmin_only`, and keeps the draft", async () => {
    await renderPanel(settings());
    api.saveRegistrationSettings.mockRejectedValue(new ApiError(403, "bot_protection_superadmin_only"));

    fireEvent.click(botSwitch());
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Turn off" }));
    fireEvent.click(saveButton());

    expect((await screen.findByRole("alert")).textContent).toBe("Only a superadmin can change the bot protection of an event.");
    expect(botSwitch().checked).toBe(false);
  });

  it("says that registration needs something when turning it on is refused for want of the keys, and reads the settings again", async () => {
    await renderPanel(settings({ bot_protection_enabled: false, mode: "automatic" }));
    api.saveRegistrationSettings.mockRejectedValue(new ApiError(409, "registration_not_ready"));
    fireEvent.click(botSwitch());
    api.fetchRegistrationSettings.mockClear();

    fireEvent.click(saveButton());

    expect((await screen.findByRole("alert")).textContent).toBe("Registration needs something that is not set up yet. Set up what the list marks as missing, then try again.");
    await waitFor(() => expect(api.fetchRegistrationSettings).toHaveBeenCalled());
  });

  it("is free of axe violations, On and Off", async () => {
    await renderPanel(settings({ bot_protection_enabled: false }));

    expect((await axe.run(botCard(), { rules: { "color-contrast": { enabled: false } } })).violations).toEqual([]);
  });
});
