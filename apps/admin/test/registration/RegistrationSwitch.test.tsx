// @vitest-environment jsdom
import { act, cleanup, fireEvent, renderHook, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/api/client.js";
import { goToLogin } from "../../src/auth/login-navigation.js";
import { useRegistrationSwitch } from "../../src/registration/RegistrationSwitch.js";
import type { RegistrationSettingsDto } from "../../src/api/types.js";
import { deferred, getTooltipText, isOff, setViewport } from "../test-utils.js";
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
/** What the badge next to the title says: Open, Closed, or Not ready with the number of steps. */
const status = () => header().querySelector(".registration-status")?.textContent ?? null;
const headerButton = (name: string | RegExp) => within(header()).queryByRole("button", { name });
const mainButton = (name: string | RegExp) => within(header()).getByRole("button", { name });
const moreButton = () => within(header()).getByRole("button", { name: /^More/ });
const GUEST_URL = "https://admitto.example.com/r/demo";

/** The "More actions" menu, opened: the names of its items. */
function openMenu(): HTMLElement {
  fireEvent.click(moreButton());
  return screen.getByRole("menu");
}
const menuItem = (name: string) => within(screen.getByRole("menu")).getByRole("menuitem", { name: new RegExp(`^${name}`) });
const menuNames = () => within(screen.getByRole("menu")).getAllByRole("menuitem").map((item) => item.querySelector(".more-actions-menu__item-text > span")?.textContent);

/** The page on the Legal tab (any tab but the Checklist has the page read the settings), with these settings, the buttons on screen. */
async function renderHeader(saved: RegistrationSettingsDto = settings({ readiness: checks() }), opts: Parameters<typeof renderPage>[0] = {}) {
  api.fetchRegistrationSettings.mockResolvedValue(saved);
  const rendered = renderPage({ path: "/admin/events/evt-1/registration?tab=legal", ...opts });
  await within(header()).findByRole("button", { name: /^More/ });
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
  vi.mocked(goToLogin).mockClear();
  Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn().mockResolvedValue(undefined) }, configurable: true });
});

afterEach(() => {
  cleanup();
});

describe("the header of the Registration page: its states", { timeout: 30_000 }, () => {
  it("is Closed with a main button to turn registration on when every check is met, and a menu that says the link waits for registration", async () => {
    await renderHeader();

    expect(status()).toBe("Closed");
    expect(isOff(mainButton("Turn registration on"))).toBe(false);
    expect(headerButton("Copy link")).toBeNull();
    openMenu();
    expect(menuNames()).toEqual(["Copy link", "See the Checklist"]);
    expect(isOff(menuItem("Copy link"))).toBe(true);
    expect(getTooltipText(menuItem("Copy link"))).toBe("This link works once registration is on.");
  });

  it("holds the room with a grey block until the first read is in, so the header does not jump", async () => {
    api.fetchRegistrationSettings.mockReturnValue(new Promise(() => undefined));
    renderPage({ path: "/admin/events/evt-1/registration?tab=legal" });

    expect(screen.getByRole("status", { name: "Loading the registration buttons" })).toBeTruthy();
    expect(status()).toBeNull();
    expect(headerButton(/^More/)).toBeNull();
  });

  it("is Not ready while a check is not met: the main button goes to the Checklist, and turning on is greyed in the menu with the number of steps", async () => {
    await renderHeader(settings({ readiness: checks("legal_documents", "mail_provider") }));

    expect(status()).toBe("Not ready: 2 steps open");
    expect(headerButton("Turn registration on")).toBeNull();
    openMenu();
    expect(menuNames()).toEqual(["Turn registration on", "Copy link"]);
    expect(isOff(menuItem("Turn registration on"))).toBe(true);
    expect(getTooltipText(menuItem("Turn registration on"))).toBe("2 steps are open. See the Checklist.");
    fireEvent.click(menuItem("Turn registration on"));
    expect(api.saveRegistrationSettings).not.toHaveBeenCalled();

    fireEvent.click(mainButton("See the Checklist"));
    await waitFor(() => expect(screen.getByRole("tab", { name: /^Checklist/ }).getAttribute("aria-selected")).toBe("true"));
  });

  it("says one step in the singular, and on the Checklist tab the main button is the greyed way on, with no way to the Checklist", async () => {
    await renderHeader(settings({ readiness: checks("legal_documents") }));
    expect(status()).toBe("Not ready: 1 step open");
    cleanup();

    await renderOnChecklist(settings({ readiness: checks("legal_documents") }));
    expect(isOff(mainButton("Turn registration on"))).toBe(true);
    expect(getTooltipText(mainButton("Turn registration on"))).toBe("1 step is open. See the Checklist.");
    expect(headerButton("See the Checklist")).toBeNull();
    openMenu();
    expect(menuNames()).toEqual(["Turn registration on", "Copy link"]);
  });

  it("is Open with Copy link as the main button, which copies the link, and a menu with Open the form, Turn registration off and the Checklist", async () => {
    await renderHeader(settings({ mode: "automatic", readiness: checks() }));

    expect(status()).toBe("Open");
    expect(isOff(mainButton("Copy link"))).toBe(false);
    fireEvent.click(mainButton("Copy link"));
    await waitFor(() => expect(addToast).toHaveBeenCalledWith("Link copied.", "success"));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(GUEST_URL);

    openMenu();
    expect(menuNames()).toEqual(["Open the form", "Turn registration off", "See the Checklist"]);
  });

  it("has no way to the Checklist in the menu on the Checklist tab itself, for registration that is Open or Closed", async () => {
    await renderOnChecklist(settings({ mode: "automatic", readiness: checks() }));
    openMenu();
    expect(menuNames()).toEqual(["Open the form", "Turn registration off"]);
    cleanup();

    await renderOnChecklist(settings({ readiness: checks() }));
    openMenu();
    expect(menuNames()).toEqual(["Copy link"]);
  });

  it("opens the form in a new tab from the menu, and goes to the Checklist from it", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    await renderHeader(settings({ mode: "automatic", readiness: checks() }));

    openMenu();
    fireEvent.click(menuItem("Open the form"));
    expect(open).toHaveBeenCalledWith(GUEST_URL, "_blank", "noopener");
    open.mockRestore();
    expect(screen.queryByRole("menu")).toBeNull();

    openMenu();
    fireEvent.click(menuItem("See the Checklist"));
    await waitFor(() => expect(screen.getByRole("tab", { name: /^Checklist/ }).getAttribute("aria-selected")).toBe("true"));
  });

  it("says when the link could not be copied", async () => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) }, configurable: true });
    await renderHeader(settings({ mode: "automatic", readiness: checks() }));

    fireEvent.click(mainButton("Copy link"));

    await waitFor(() => expect(addToast).toHaveBeenCalledWith("Could not copy the link.", "error"));
  });

  it("has no link to copy or open while the instance has no address, and says who sets it", async () => {
    await renderHeader(settings({ mode: "automatic", guest_url: null, readiness: checks() }));

    expect(isOff(mainButton("Copy link"))).toBe(true);
    expect(getTooltipText(mainButton("Copy link"))).toBe("There is no link yet, because the address of this instance is not set. Ask a superadmin to set it up.");
    openMenu();
    expect(menuNames()).toEqual(["Turn registration off", "See the Checklist"]);
  });

  it("says that the link is not there, in the greyed Copy link of the menu, while registration is off and the instance has no address", async () => {
    await renderHeader(settings({ guest_url: null, readiness: checks() }));

    openMenu();
    expect(getTooltipText(menuItem("Copy link"))).toBe("There is no link yet, because the address of this instance is not set. Ask a superadmin to set it up.");
  });

  it("is locked on an archived event that is Open: turning off is greyed with the reason of the archive, and the link can still be copied", async () => {
    await renderHeader(settings({ mode: "automatic", readiness: checks() }), { withEvent: archivedEvent });

    expect(isOff(mainButton("Copy link"))).toBe(false);
    openMenu();
    expect(isOff(menuItem("Turn registration off"))).toBe(true);
    expect(getTooltipText(menuItem("Turn registration off"))).toBe("This event is archived. Editing is disabled.");
  });

  it("is locked on an archived event that is Closed: turning on is greyed, with the reason, in the header and in the menu", async () => {
    await renderHeader(settings({ readiness: checks() }), { withEvent: archivedEvent });

    expect(isOff(mainButton("Turn registration on"))).toBe(true);
    expect(getTooltipText(mainButton("Turn registration on"))).toBe("This event is archived. Editing is disabled.");
    fireEvent.click(mainButton("Turn registration on"));
    expect(api.saveRegistrationSettings).not.toHaveBeenCalled();
  });

  it("gives the archived reason before the open steps on an archived event that is not ready", async () => {
    await renderHeader(settings({ readiness: checks("legal_documents") }), { withEvent: archivedEvent });

    openMenu();
    expect(getTooltipText(menuItem("Turn registration on"))).toBe("This event is archived. Editing is disabled.");
  });

  it("has the buttons on every tab of the page", async () => {
    for (const tab of ["requests", "fields", "legal", "checklist"]) {
      api.fetchRegistrationSettings.mockResolvedValue(settings({ readiness: checks() }));
      renderPage({ path: `/admin/events/evt-1/registration?tab=${tab}` });
      expect(await within(header()).findByRole("button", { name: "Turn registration on" }), tab).toBeTruthy();
      cleanup();
    }
  });

  it("shortens the labels on a narrow screen, as the Attendees header does", async () => {
    setViewport(false);
    await renderHeader();
    expect(mainButton("Turn on")).toBeTruthy();
    expect(moreButton().textContent).toBe("More");
    cleanup();

    await renderHeader(settings({ readiness: checks("legal_documents") }));
    expect(mainButton("Checklist")).toBeTruthy();
    expect(moreButton().textContent).toBe("More");
  });

  it("has the name of the page and the state in the title, and the long labels on a wide screen", async () => {
    await renderHeader();

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("RegistrationClosed");
    expect(moreButton().textContent).toBe("More actions");
  });
});

describe("the header of the Registration page: turning registration on", { timeout: 30_000 }, () => {
  it("sends the mode that waits for approval, says so, and shows Open, with Copy link", async () => {
    await renderHeader();
    api.saveRegistrationSettings.mockResolvedValue(settings({ mode: "approval", readiness: checks() }));

    fireEvent.click(mainButton("Turn registration on"));

    await waitFor(() => expect(api.saveRegistrationSettings).toHaveBeenCalledWith("evt-1", { mode: "approval" }));
    await waitFor(() => expect(status()).toBe("Open"));
    expect(addToast).toHaveBeenCalledWith("Registration is on.", "success");
    expect(isOff(mainButton("Copy link"))).toBe(false);
  });

  it("is busy while the request runs: the button is loading, not disabled, and a second click sends nothing", async () => {
    await renderHeader();
    const answer = deferred<RegistrationSettingsDto>();
    api.saveRegistrationSettings.mockReturnValue(answer.promise);

    fireEvent.click(mainButton("Turn registration on"));
    await waitFor(() => expect(mainButton("Turn registration on").getAttribute("aria-busy")).toBe("true"));
    expect((mainButton("Turn registration on") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(mainButton("Turn registration on"));

    expect(api.saveRegistrationSettings).toHaveBeenCalledTimes(1);
    await act(async () => answer.resolve(settings({ mode: "approval", readiness: checks() })));
    await waitFor(() => expect(status()).toBe("Open"));
  });

  it("says what is missing at the header when the server refuses, in the words of the app, and reads the settings again", async () => {
    await renderHeader();
    api.saveRegistrationSettings.mockRejectedValue(refusal(409, "registration_not_ready", ["legal_documents"]));
    api.fetchRegistrationSettings.mockResolvedValue(settings({ readiness: checks("legal_documents") }));

    fireEvent.click(mainButton("Turn registration on"));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("This change needs something that is not set up yet.");
    expect(within(alert).getAllByRole("listitem").map((item) => item.textContent)).toEqual(["Publish the privacy notice, the terms and every consent you chose. Open the Legal tab."]);
    await waitFor(() => expect(status()).toBe("Not ready: 1 step open"));
    expect(addToast).not.toHaveBeenCalled();
  });

  it("says it could not save in the words of the app, never the server's, and stays Closed", async () => {
    await renderHeader();
    api.saveRegistrationSettings.mockRejectedValue(refusal(500, "unexpected_failure"));

    fireEvent.click(mainButton("Turn registration on"));

    expect((await screen.findByRole("alert")).textContent).not.toContain("unexpected_failure");
    expect(status()).toBe("Closed");
  });

  it("hands the browser to the sign-in when the session has ended, and says nothing", async () => {
    await renderHeader();
    api.saveRegistrationSettings.mockRejectedValue(refusal(401, "authentication_required"));

    fireEvent.click(mainButton("Turn registration on"));

    await waitFor(() => expect(goToLogin).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
    expect(addToast).not.toHaveBeenCalled();
  });

  it("says it could not save, in the words of the app, when the request fails with something that is not an answer of the server", async () => {
    await renderHeader();
    api.saveRegistrationSettings.mockRejectedValue(new Error("connection reset"));

    fireEvent.click(mainButton("Turn registration on"));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Could not save the registration settings.");
    expect(alert.textContent).not.toContain("connection reset");
  });

  it("has the page read the event again when the event turns out to be archived", async () => {
    await renderHeader();
    api.saveRegistrationSettings.mockRejectedValue(refusal(403, "event_archived"));

    fireEvent.click(mainButton("Turn registration on"));

    await waitFor(() => expect(refreshEvent).toHaveBeenCalled());
  });
});

describe("the switch of registration: requests that must not start", { timeout: 30_000 }, () => {
  it("sends one request while one is out, and none without an event", async () => {
    const answer = deferred<RegistrationSettingsDto>();
    api.saveRegistrationSettings.mockReturnValue(answer.promise);
    const { result } = renderHook(() => useRegistrationSwitch({ eventId: "evt-1", settings: settings({ readiness: checks() }), onSettings: vi.fn() }));

    act(() => result.current.request("approval"));
    act(() => result.current.request("approval"));
    expect(api.saveRegistrationSettings).toHaveBeenCalledTimes(1);
    await act(async () => answer.resolve(settings({ mode: "approval", readiness: checks() })));

    const none = renderHook(() => useRegistrationSwitch({ eventId: undefined, settings: null, onSettings: vi.fn() }));
    act(() => none.result.current.request("approval"));
    expect(api.saveRegistrationSettings).toHaveBeenCalledTimes(1);
  });
});

describe("the header of the Registration page: turning registration off", { timeout: 30_000 }, () => {
  async function open() {
    await renderHeader(settings({ mode: "approval", readiness: checks() }));
    openMenu();
    fireEvent.click(menuItem("Turn registration off"));
    return screen.findByRole("dialog", { name: "Turn off registration?" });
  }

  it("asks first, says what it does, and sends nothing until it is confirmed", async () => {
    const dialog = await open();

    expect(within(dialog).getByText("Guests can no longer open the form, and confirmation links stop working until you turn registration on again. Requests you already have stay on the Requests tab.")).toBeTruthy();
    expect(within(dialog).queryByRole("list")).toBeNull();
    expect(api.saveRegistrationSettings).not.toHaveBeenCalled();
    expect(status()).toBe("Open");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("sends the mode as none when it is confirmed, and says that registration is off", async () => {
    const dialog = await open();
    api.saveRegistrationSettings.mockResolvedValue(settings({ mode: null, readiness: checks() }));

    fireEvent.click(within(dialog).getByRole("button", { name: "Turn off registration" }));

    await waitFor(() => expect(api.saveRegistrationSettings).toHaveBeenCalledWith("evt-1", { mode: null }));
    await waitFor(() => expect(status()).toBe("Closed"));
    expect(addToast).toHaveBeenCalledWith("Registration is off.", "success");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("sends nothing when it is called off", async () => {
    const dialog = await open();

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.saveRegistrationSettings).not.toHaveBeenCalled();
    expect(status()).toBe("Open");
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

    expect(status()).toBe("Open");
    openMenu();
    expect(isOff(menuItem("Turn registration off"))).toBe(false);
  });
});

describe("the Checklist tab and the header are one state", { timeout: 30_000 }, () => {
  it("has a primary button Turn registration on in the ready banner, which does what the header button does, and the header follows", async () => {
    await renderOnChecklist(settings({ readiness: checks() }));
    expect(banner().textContent).toContain("Ready. Registration can be turned on.");
    api.saveRegistrationSettings.mockResolvedValue(settings({ mode: "approval", readiness: checks() }));

    fireEvent.click(within(banner()).getByRole("button", { name: "Turn registration on" }));

    await waitFor(() => expect(api.saveRegistrationSettings).toHaveBeenCalledWith("evt-1", { mode: "approval" }));
    await waitFor(() => expect(status()).toBe("Open"));
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

    await waitFor(() => expect(status()).toBe("Closed"));
    expect(banner().textContent).toContain("Ready. Registration can be turned on.");
  });

  it("follows the button of the header: turning on there changes the banner", async () => {
    await renderOnChecklist(settings({ readiness: checks() }));
    api.saveRegistrationSettings.mockResolvedValue(settings({ mode: "automatic", readiness: checks() }));

    fireEvent.click(mainButton("Turn registration on"));

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

    fireEvent.click(mainButton("Turn registration on"));

    expect(await screen.findByRole("tab", { name: "Checklist, 1 step open" })).toBeTruthy();
  });
});
