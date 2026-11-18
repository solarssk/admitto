// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/api/client.js";
import type { RegistrationSettingsDto } from "../../src/api/types.js";
import { deferred, getTooltipText, isOff } from "../test-utils.js";
import { addToast, api, refreshEvent } from "./accessApiMocks.js";
import { archivedEvent, checks, settings } from "./accessData.js";
import { checklistLoaded, renderChecklist, renderPage, resetApi } from "./accessFixtures.js";

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const { api: mocks } = await import("./accessApiMocks.js");
  return {
    ...(await importOriginal<typeof import("../../src/api/client.js")>()),
    fetchRegistrationSettings: (...args: unknown[]) => mocks.fetchRegistrationSettings(...args),
    saveRegistrationSettings: (...args: unknown[]) => mocks.saveRegistrationSettings(...args),
    fetchLegalDocuments: (...args: unknown[]) => mocks.fetchLegalDocuments(...args),
    fetchRegistrationCounts: (...args: unknown[]) => mocks.fetchRegistrationCounts(...args),
  };
});
vi.mock("../../src/connection/ConnectionStateProvider.js");
vi.mock("../../src/auth/login-navigation.js", () => ({ goToLogin: vi.fn() }));
vi.mock("@admitto/ui", async (importOriginal) => {
  const { addToast: toast } = await import("./accessApiMocks.js");
  return { ...(await importOriginal<typeof import("@admitto/ui")>()), useToast: () => ({ addToast: toast }) };
});

const refusal = (status: number, code: string, blockers?: string[]) => new ApiError(status, code, code, undefined, undefined, undefined, undefined, blockers);

const header = () => document.querySelector(".at-pageheader") as HTMLElement;
const regSwitch = () => within(header()).getByRole("switch", { name: "Registration" }) as HTMLInputElement;
const copyLink = () => within(header()).getByRole("button", { name: "Copy link" });
const checklistLink = () => within(header()).queryByRole("link", { name: "See the Checklist" });

/** The page on the Legal tab (any tab but the Checklist has the page read the settings), with these settings, the switch on screen. */
async function renderHeader(saved: RegistrationSettingsDto = settings({ readiness: checks() }), opts: Parameters<typeof renderPage>[0] = {}) {
  api.fetchRegistrationSettings.mockResolvedValue(saved);
  const rendered = renderPage({ path: "/admin/events/evt-1/registration?tab=legal", ...opts });
  await screen.findByRole("switch", { name: "Registration" });
  return rendered;
}

async function renderOnChecklist(saved: RegistrationSettingsDto) {
  api.fetchRegistrationSettings.mockResolvedValue(saved);
  const rendered = renderChecklist();
  await checklistLoaded();
  return rendered;
}

const banner = () => document.querySelector(".at-notice") as HTMLElement;

beforeEach(() => {
  resetApi();
  // The Requests tab asks the browser about the width of the screen.
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({ matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn() }));
});

afterEach(() => {
  cleanup();
});

describe("the registration switch in the header: its states", () => {
  it("is Off and can be turned on when every check is met, with a link to copy that waits for registration", async () => {
    await renderHeader();

    expect(regSwitch().checked).toBe(false);
    expect(within(header()).getByText("Off")).toBeTruthy();
    expect(isOff(regSwitch())).toBe(false);
    expect(checklistLink()).toBeNull();
    expect(isOff(copyLink())).toBe(true);
  });

  it("holds the room with a grey pill until the first read is in, so the header does not jump", async () => {
    api.fetchRegistrationSettings.mockReturnValue(new Promise(() => undefined));
    renderPage({ path: "/admin/events/evt-1/registration?tab=legal" });

    expect(screen.getByRole("status", { name: "Loading the registration switch" })).toBeTruthy();
    expect(screen.queryByRole("switch", { name: "Registration" })).toBeNull();
  });

  it("is greyed while a check is not met, says how many steps are open, and has a link to the Checklist tab", async () => {
    await renderHeader(settings({ readiness: checks("legal_documents", "mail_provider") }));

    expect(isOff(regSwitch())).toBe(true);
    expect(screen.getAllByText("2 steps are open. See the Checklist.").length).toBeGreaterThan(0);
    expect(checklistLink()?.getAttribute("href")).toBe("/admin/events/evt-1/registration?tab=checklist");
    fireEvent.click(regSwitch());
    expect(api.saveRegistrationSettings).not.toHaveBeenCalled();
  });

  it("says one step in the singular, and has no link to the Checklist on the Checklist tab itself", async () => {
    await renderHeader(settings({ readiness: checks("legal_documents") }));
    expect(screen.getAllByText("1 step is open. See the Checklist.").length).toBeGreaterThan(0);
    cleanup();

    await renderOnChecklist(settings({ readiness: checks("legal_documents") }));
    expect(isOff(regSwitch())).toBe(true);
    expect(checklistLink()).toBeNull();
  });

  it("is On with the link to copy when registration is on, and copies it", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    await renderHeader(settings({ mode: "automatic", readiness: checks() }));

    expect(regSwitch().checked).toBe(true);
    expect(within(header()).getByText("On")).toBeTruthy();
    expect(isOff(copyLink())).toBe(false);
    fireEvent.click(copyLink());

    await waitFor(() => expect(addToast).toHaveBeenCalledWith("Link copied.", "success"));
    expect(writeText).toHaveBeenCalledWith("https://admitto.example.com/r/demo");
  });

  it("says when the link could not be copied", async () => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) }, configurable: true });
    await renderHeader(settings({ mode: "automatic", readiness: checks() }));

    fireEvent.click(copyLink());

    await waitFor(() => expect(addToast).toHaveBeenCalledWith("Could not copy the link.", "error"));
  });

  it("has no link to copy while the instance has no address, and says who sets it", async () => {
    await renderHeader(settings({ mode: "automatic", guest_url: null, readiness: checks() }));

    expect(isOff(copyLink())).toBe(true);
    expect(getTooltipText(copyLink())).toBe("There is no link yet, because the address of this instance is not set. Ask a superadmin to set it up.");
  });

  it("is locked on an archived event, with the reason of the archive", async () => {
    await renderHeader(settings({ mode: "automatic", readiness: checks() }), { withEvent: archivedEvent });

    expect(isOff(regSwitch())).toBe(true);
    expect(screen.getAllByText("This event is archived. Editing is disabled.").length).toBeGreaterThan(0);
    // Reading is not editing: the link can still be copied.
    expect(isOff(copyLink())).toBe(false);
  });

  it("is on every tab of the page", async () => {
    for (const tab of ["requests", "fields", "legal", "checklist"]) {
      api.fetchRegistrationSettings.mockResolvedValue(settings({ readiness: checks() }));
      renderPage({ path: `/admin/events/evt-1/registration?tab=${tab}` });
      expect(await screen.findByRole("switch", { name: "Registration" }), tab).toBeTruthy();
      cleanup();
    }
  });
});

describe("the registration switch in the header: turning registration on", () => {
  it("sends the mode that waits for approval, says so, and shows On, with the link", async () => {
    await renderHeader();
    api.saveRegistrationSettings.mockResolvedValue(settings({ mode: "approval", readiness: checks() }));

    fireEvent.click(regSwitch());

    await waitFor(() => expect(api.saveRegistrationSettings).toHaveBeenCalledWith("evt-1", { mode: "approval" }));
    await waitFor(() => expect(regSwitch().checked).toBe(true));
    expect(addToast).toHaveBeenCalledWith("Registration is on.", "success");
    expect(isOff(copyLink())).toBe(false);
  });

  it("is busy while the request runs: aria-disabled, and a second click sends nothing", async () => {
    await renderHeader();
    const answer = deferred<RegistrationSettingsDto>();
    api.saveRegistrationSettings.mockReturnValue(answer.promise);

    fireEvent.click(regSwitch());
    await waitFor(() => expect(regSwitch().getAttribute("aria-disabled")).toBe("true"));
    fireEvent.click(regSwitch());

    expect(api.saveRegistrationSettings).toHaveBeenCalledTimes(1);
    await act(async () => answer.resolve(settings({ mode: "approval", readiness: checks() })));
    await waitFor(() => expect(regSwitch().hasAttribute("aria-disabled")).toBe(false));
  });

  it("says what is missing at the header when the server refuses, in the words of the app, and reads the settings again", async () => {
    await renderHeader();
    api.saveRegistrationSettings.mockRejectedValue(refusal(409, "registration_not_ready", ["legal_documents"]));
    api.fetchRegistrationSettings.mockResolvedValue(settings({ readiness: checks("legal_documents") }));

    fireEvent.click(regSwitch());

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("This change needs something that is not set up yet.");
    expect(within(alert).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["Publish the privacy notice, the terms and every consent you chose. Open the Legal tab."]);
    expect(regSwitch().checked).toBe(false);
    await waitFor(() => expect(isOff(regSwitch())).toBe(true));
    expect(addToast).not.toHaveBeenCalled();
  });

  it("says it could not save in the words of the app, never the server's, and keeps the switch Off", async () => {
    await renderHeader();
    api.saveRegistrationSettings.mockRejectedValue(refusal(500, "unexpected_failure"));

    fireEvent.click(regSwitch());

    expect((await screen.findByRole("alert")).textContent).not.toContain("unexpected_failure");
    expect(regSwitch().checked).toBe(false);
  });

  it("has the page read the event again when the event turns out to be archived", async () => {
    await renderHeader();
    api.saveRegistrationSettings.mockRejectedValue(refusal(403, "event_archived"));

    fireEvent.click(regSwitch());

    await waitFor(() => expect(refreshEvent).toHaveBeenCalled());
  });
});

describe("the registration switch in the header: turning registration off", () => {
  async function open() {
    await renderHeader(settings({ mode: "approval", readiness: checks() }));
    fireEvent.click(regSwitch());
    return screen.findByRole("dialog", { name: "Turn off registration?" });
  }

  it("asks first, says what it does, and sends nothing until it is confirmed", async () => {
    const dialog = await open();

    expect(within(dialog).getByText(/The requests you already have stay/)).toBeTruthy();
    expect(api.saveRegistrationSettings).not.toHaveBeenCalled();
    expect(regSwitch().checked).toBe(true);
  });

  it("sends the mode as none when it is confirmed, and says that registration is off", async () => {
    const dialog = await open();
    api.saveRegistrationSettings.mockResolvedValue(settings({ mode: null, readiness: checks() }));

    fireEvent.click(within(dialog).getByRole("button", { name: "Turn off registration" }));

    await waitFor(() => expect(api.saveRegistrationSettings).toHaveBeenCalledWith("evt-1", { mode: null }));
    await waitFor(() => expect(regSwitch().checked).toBe(false));
    expect(addToast).toHaveBeenCalledWith("Registration is off.", "success");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("sends nothing when it is called off", async () => {
    const dialog = await open();

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.saveRegistrationSettings).not.toHaveBeenCalled();
    expect(regSwitch().checked).toBe(true);
  });

  it("shows a failure in the dialog, not in a toast, and keeps the dialog so that it can be tried again", async () => {
    const dialog = await open();
    api.saveRegistrationSettings.mockRejectedValue(refusal(500, "unexpected_failure"));

    fireEvent.click(within(dialog).getByRole("button", { name: "Turn off registration" }));

    await waitFor(() => expect(api.saveRegistrationSettings).toHaveBeenCalled());
    expect(screen.getByRole("dialog", { name: "Turn off registration?" })).toBeTruthy();
    expect(addToast).not.toHaveBeenCalled();
  });

  it("is possible while checks are missing: turning off is never refused", async () => {
    await renderHeader(settings({ mode: "approval", readiness: checks("legal_documents") }));

    expect(isOff(regSwitch())).toBe(false);
  });
});

describe("the Checklist tab and the switch are one state", () => {
  it("has a primary button Turn registration on in the ready banner, which does what the switch does, and the header follows", async () => {
    await renderOnChecklist(settings({ readiness: checks() }));
    expect(banner().textContent).toContain("Ready. Registration can be turned on.");
    api.saveRegistrationSettings.mockResolvedValue(settings({ mode: "approval", readiness: checks() }));

    fireEvent.click(within(banner()).getByRole("button", { name: "Turn registration on" }));

    await waitFor(() => expect(api.saveRegistrationSettings).toHaveBeenCalledWith("evt-1", { mode: "approval" }));
    await waitFor(() => expect(regSwitch().checked).toBe(true));
    expect(banner().textContent).toContain("Registration is open.");
    expect(within(banner()).getByRole("button", { name: "Turn off" })).toBeTruthy();
    expect(within(banner()).queryByRole("button", { name: "Turn registration on" })).toBeNull();
    // Nothing was read again for it: the answer of the save is the state.
    expect(api.fetchRegistrationSettings).toHaveBeenCalledTimes(1);
  });

  it("turns off from the banner with the same question, and the header follows", async () => {
    await renderOnChecklist(settings({ mode: "automatic", readiness: checks() }));
    expect(banner().textContent).toContain("Registration is open.");

    fireEvent.click(within(banner()).getByRole("button", { name: "Turn off" }));
    const dialog = await screen.findByRole("dialog", { name: "Turn off registration?" });
    api.saveRegistrationSettings.mockResolvedValue(settings({ mode: null, readiness: checks() }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Turn off registration" }));

    await waitFor(() => expect(regSwitch().checked).toBe(false));
    expect(banner().textContent).toContain("Ready. Registration can be turned on.");
  });

  it("follows the switch of the header: turning on there changes the banner", async () => {
    await renderOnChecklist(settings({ readiness: checks() }));
    api.saveRegistrationSettings.mockResolvedValue(settings({ mode: "automatic", readiness: checks() }));

    fireEvent.click(regSwitch());

    await waitFor(() => expect(banner().textContent).toContain("Registration is open."));
  });

  it("has the banner without a button while steps are open, and the button is busy while the request runs", async () => {
    await renderOnChecklist(settings({ readiness: checks("legal_documents") }));
    expect(within(banner()).queryByRole("button")).toBeNull();
    cleanup();

    await renderOnChecklist(settings({ readiness: checks() }));
    const answer = deferred<RegistrationSettingsDto>();
    api.saveRegistrationSettings.mockReturnValue(answer.promise);
    fireEvent.click(within(banner()).getByRole("button", { name: "Turn registration on" }));
    await waitFor(() => expect(within(banner()).getByRole("button").getAttribute("aria-busy")).toBe("true"));
    await act(async () => answer.resolve(settings({ mode: "approval", readiness: checks() })));
  });

  it("has no button on an archived event", async () => {
    api.fetchRegistrationSettings.mockResolvedValue(settings({ readiness: checks() }));
    renderChecklist({ withEvent: archivedEvent });
    await checklistLoaded();

    expect(within(banner()).queryByRole("button")).toBeNull();
  });

  it("refreshes the number on the Checklist tab from the answer of the save, since readiness may change with it", async () => {
    await renderHeader(settings({ readiness: checks() }));
    expect(screen.getByRole("tab", { name: "Checklist" })).toBeTruthy();
    api.saveRegistrationSettings.mockResolvedValue(settings({ mode: "approval", readiness: checks("bot_protection") }));

    fireEvent.click(regSwitch());

    expect(await screen.findByRole("tab", { name: "Checklist, 1 step open" })).toBeTruthy();
  });
});
