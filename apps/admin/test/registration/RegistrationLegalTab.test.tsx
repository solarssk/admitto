// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router";
import { ToastProvider } from "@admitto/ui";
import { ApiError } from "../../src/api/client.js";
import type { EventDto, LegalDocumentDto, LegalDocumentLimitsDto, LegalDocumentsListResponse, LegalDocumentWithContentDto } from "../../src/api/types.js";
import { reportApiError } from "../../src/connection/ConnectionStateProvider.js";
import { RegistrationPage } from "../../src/pages/RegistrationPage.js";
import { LOAD_TIMEOUT_MESSAGE, SLOW_NOTICE_TEXT } from "../../src/utils/loading-timing.js";
import { advanceTimers, deferred, getTooltipText, hangUntilAborted, isOff, setViewport } from "../test-utils.js";
import { LEGAL_LIMITS, legalDoc, legalDocWithContent } from "./legalFixtures.js";
import { stubProseMirrorLayout } from "./proseMirrorJsdom.js";

const fetchLegalDocuments = vi.fn();
const fetchLegalDocument = vi.fn();
const saveLegalDocument = vi.fn();
const publishLegalDocument = vi.fn();
const unpublishLegalDocument = vi.fn();
const deleteLegalDocument = vi.fn();
const saveRegistrationSettings = vi.fn();
const fetchAdminEvents = vi.fn();
const fetchRegistrationSettings = vi.fn();

vi.mock("../../src/api/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/api/client.js")>()),
  fetchLegalDocuments: (...args: unknown[]) => fetchLegalDocuments(...args),
  fetchLegalDocument: (...args: unknown[]) => fetchLegalDocument(...args),
  saveLegalDocument: (...args: unknown[]) => saveLegalDocument(...args),
  publishLegalDocument: (...args: unknown[]) => publishLegalDocument(...args),
  unpublishLegalDocument: (...args: unknown[]) => unpublishLegalDocument(...args),
  saveRegistrationSettings: (...args: unknown[]) => saveRegistrationSettings(...args),
  deleteLegalDocument: (...args: unknown[]) => deleteLegalDocument(...args),
  fetchAdminEvents: (...args: unknown[]) => fetchAdminEvents(...args),
  fetchRegistrationSettings: (...args: unknown[]) => fetchRegistrationSettings(...args),
}));

vi.mock("../../src/connection/ConnectionStateProvider.js");

const addToast = vi.fn();
vi.mock("@admitto/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@admitto/ui")>();
  return { ...actual, useToast: () => ({ addToast }) };
});

const event = { id: "evt-1", title: "Demo", slug: "demo", archived_at: null } as EventDto;
const archivedEvent = { ...event, archived_at: "2026-10-01T10:00:00.000Z" } as EventDto;
const limits: LegalDocumentLimitsDto = { ...LEGAL_LIMITS, consents: 2 };

const doc = legalDoc;
const withContent = (item: LegalDocumentDto): LegalDocumentWithContentDto => legalDocWithContent(item.ref, item);
const privacy = doc("privacy-notice", { published: true, published_at: "2026-10-20T10:00:00.000Z" });
const photo = doc("consent-photo", { title: "Photos and video", required: true });

function answer(items: LegalDocumentDto[], missing: LegalDocumentsListResponse["missing"] = []): LegalDocumentsListResponse {
  return { items, missing, limits };
}

/** What the event frame gives every page of an event: the event, in the outlet context. */
function renderTab({ withEvent = event, path = "/admin/events/evt-1/registration?tab=legal" } = {}) {
  const router = createMemoryRouter(
    [
      {
        element: <Outlet context={{ event: withEvent }} />,
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

const legalPanel = () => screen.getByRole("tabpanel", { name: "Legal" });
const placeholder = () => screen.queryByRole("status", { name: "Loading legal texts" });
const rows = () => Array.from(legalPanel().querySelectorAll<HTMLElement>("tbody tr"));
const rowTitles = () => rows().map((row) => row.querySelector(".requirements-item-name")?.textContent);

/** Waits until the list is on screen: the placeholder draws the card's title too, so the title alone is not the answer. */
async function listLoaded() {
  await waitFor(() => expect(placeholder()).toBeNull());
  await screen.findByText("Required texts");
}

beforeAll(() => {
  stubProseMirrorLayout();
});

beforeEach(() => {
  setViewport(true);
  fetchRegistrationSettings.mockResolvedValue({ mode: null, guest_url: null, readiness: [], own_address: null });
  fetchLegalDocuments.mockResolvedValue(answer([privacy], [{ ref: "event-terms", kind: "event_terms", key: null }]));
  fetchLegalDocument.mockImplementation(async (_event: string, ref: string) => withContent(ref === "privacy-notice" ? privacy : doc(ref)));
  fetchAdminEvents.mockResolvedValue([event]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("RegistrationLegalTab: a route without an event", () => {
  it("says there is no event, without reading anything", () => {
    renderTab({ path: "/admin/registration?tab=legal" });

    expect(screen.getByText("Missing event.")).toBeTruthy();
    expect(fetchLegalDocuments).not.toHaveBeenCalled();
  });
});

describe("RegistrationLegalTab: the first read", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // A read that a test has not set up hangs, instead of answering with nothing.
    fetchLegalDocuments.mockImplementation(hangUntilAborted as never);
  });

  it("holds the room of the card invisibly for 200ms, then draws it grey with its real title, and says it is taking longer after 8 seconds", async () => {
    renderTab();
    await advanceTimers(0);

    const held = placeholder() as HTMLElement;
    expect(held.classList.contains("at-loading-hold")).toBe(true);
    expect(within(held).getByText("Required texts")).toBeTruthy();
    expect(within(held).getByText("Extra consents")).toBeTruthy();
    // The shapes are decoration; nothing claims that there is nothing yet.
    expect(held.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
    expect(screen.queryByText("Privacy notice")).toBeNull();

    await advanceTimers(200);
    expect(placeholder()?.classList.contains("at-loading-hold")).toBe(false);
    expect(screen.queryByText(SLOW_NOTICE_TEXT)).toBeNull();

    await advanceTimers(8000);
    expect(within(placeholder() as HTMLElement).getByText(SLOW_NOTICE_TEXT)).toBeTruthy();
  });

  it("ends in an error after 30 seconds, with a Retry that stays on screen, busy, with its focus, and hands the focus to the tab when it works", async () => {
    renderTab();
    await advanceTimers(0);
    await advanceTimers(30_000);
    await advanceTimers(0);
    expect(screen.getByRole("alert").textContent).toContain(LOAD_TIMEOUT_MESSAGE);
    expect(screen.getByRole("alert").textContent).toContain("Could not load the legal texts");

    const read = deferred<LegalDocumentsListResponse>();
    fetchLegalDocuments.mockReturnValueOnce(read.promise);
    const retry = screen.getByRole("button", { name: "Retry" });
    retry.focus();
    fireEvent.click(retry);
    await advanceTimers(500);
    expect(retry.getAttribute("aria-busy")).toBe("true");
    expect(retry.hasAttribute("disabled")).toBe(false);
    expect(document.activeElement).toBe(retry);
    expect(placeholder()).toBeNull();

    await act(async () => read.resolve(answer([privacy])));
    await advanceTimers(500);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Event terms")).toBeTruthy();
    expect(document.activeElement).toBe(legalPanel());
  });
});

describe("RegistrationLegalTab: a read that fails", () => {
  it("is an error with the words of the app, never an empty list, and the connection state hears of it", async () => {
    fetchLegalDocuments.mockRejectedValue(new ApiError(403, "forbidden", "forbidden"));
    renderTab();

    const alert = await screen.findByRole("alert");

    expect(alert.textContent).toContain("Could not load the legal texts");
    expect(alert.textContent).toContain("You do not have access.");
    expect(screen.queryByText("Privacy notice")).toBeNull();
    expect(reportApiError).toHaveBeenCalledWith(403);
  });
});

describe("RegistrationLegalTab: the list", () => {
  it("is two cards, Required texts and Extra consents, each with a plain table of the shared kind", async () => {
    fetchLegalDocuments.mockResolvedValue(answer([privacy, photo]));
    renderTab();
    await listLoaded();

    const titles = Array.from(legalPanel().querySelectorAll(".at-card__title")).map((node) => node.textContent);
    expect(titles).toEqual(["Required texts", "Extra consents"]);
    const sections = Array.from(legalPanel().querySelectorAll("section"));
    expect(sections).toHaveLength(2);
    for (const section of sections) {
      expect(section.classList.contains("item-table")).toBe(true);
      expect(section.querySelector(".attendees-table-wrap > table.table")).not.toBeNull();
    }
    expect(screen.getByText("Always on the form. Both must be published before registration can be turned on.")).toBeTruthy();
    expect(screen.getByText("Optional checkboxes the form asks guests to tick.")).toBeTruthy();
  });

  it("names the columns Text and Status, and Asked for the consents only, with the rule behind an info hint", async () => {
    fetchLegalDocuments.mockResolvedValue(answer([privacy, photo]));
    renderTab();
    await listLoaded();

    const [required, consents] = Array.from(legalPanel().querySelectorAll("table"));
    const heads = (table: Element | undefined) => Array.from(table?.querySelectorAll("thead th") ?? []).map((th) => th.textContent?.trim());
    expect(heads(required)).toEqual(["Text", "Status", ""]);
    expect(heads(consents)).toEqual(["Text", "Status", "Asked", ""]);
    expect(within(consents as HTMLElement).getByText("Asked").closest("th")?.querySelector(".ti-info-circle, [data-hint], button, svg, i")).not.toBeNull();
  });

  it("shows the privacy notice and the terms first, whether they are written or not, then the consents, each with what it is for", async () => {
    fetchLegalDocuments.mockResolvedValue(answer([privacy, photo]));
    renderTab();
    await listLoaded();

    expect(rowTitles()).toEqual(["Privacy notice", "Event terms", "Photos and video"]);
    const [noticeRow, termsRow, consentRow] = rows();
    expect(within(noticeRow!).getAllByText("Published").length).toBeGreaterThan(0);
    expect(within(termsRow!).getAllByText("Not written").length).toBeGreaterThan(0);
    expect(within(consentRow!).getAllByText("Draft").length).toBeGreaterThan(0);
    expect(noticeRow!.textContent).toContain("Tells guests how their data is used. Linked from the form.");
    expect(termsRow!.textContent).toContain("Not written yet. Registration cannot open without it.");
    expect(consentRow!.textContent).toContain("Key: photo");
  });

  it("has one visible action in a row, Edit or Write, and the vertical kebab", async () => {
    fetchLegalDocuments.mockResolvedValue(answer([privacy, photo]));
    renderTab();
    await listLoaded();

    const [noticeRow, termsRow] = rows();
    const visible = (row: HTMLElement) => within(row).getAllByRole("button").map((control) => control.textContent?.trim()).filter(Boolean);
    expect(visible(noticeRow!)).toEqual(["Edit"]);
    expect(visible(termsRow!)).toEqual(["Write"]);
    expect(within(noticeRow!).getByRole("button", { name: "Edit Privacy notice" }).className).toContain("at-btn--secondary");
    expect(within(noticeRow!).getByRole("button", { name: "More actions for Privacy notice" }).querySelector(".ti-dots-vertical")).not.toBeNull();
    // A text that is not written has nothing to publish or delete: no menu.
    expect(within(termsRow!).queryByRole("button", { name: /More actions/ })).toBeNull();
  });

  it("says what registration still needs published, by the names the list shows, and says nothing when nothing is missing", async () => {
    fetchLegalDocuments.mockResolvedValue(
      answer([privacy, photo], [{ ref: "event-terms", kind: "event_terms", key: null }, { ref: "consent-photo", kind: "consent", key: "photo" }]),
    );
    renderTab();
    await listLoaded();

    expect(screen.getByText("Registration cannot be turned on until these are published: Event terms, Photos and video.")).toBeTruthy();

    cleanup();
    fetchLegalDocuments.mockResolvedValue(answer([privacy, doc("event-terms", { published: true })]));
    renderTab();
    await listLoaded();
    expect(screen.queryByText(/Registration cannot be turned on/)).toBeNull();
  });

  it("puts Copy from another event in the first card and Add consent in the second, both small and secondary, as on the Fields tab (#1883)", async () => {
    renderTab();
    await listLoaded();

    const [requiredCard, consentsCard] = Array.from(legalPanel().querySelectorAll<HTMLElement>(".at-card"));
    expect(within(requiredCard!).getByRole("button", { name: "Copy from another event" })).toBeTruthy();
    // No consents yet: the empty state has its own button, and the header keeps its own.
    expect(within(consentsCard!).getAllByRole("button", { name: "Add consent" })).toHaveLength(2);
    for (const control of [screen.getByRole("button", { name: "Copy from another event" }), ...screen.getAllByRole("button", { name: "Add consent" })]) {
      expect(control.className).toContain("at-btn--sm");
      expect(control.className).toContain("at-btn--secondary");
    }
  });

  it("says in the second card that there is no consent yet, with an Add consent inside the card, and no table", async () => {
    renderTab();
    await listLoaded();

    expect(screen.getByText("No extra consents yet")).toBeTruthy();
    expect(legalPanel().querySelectorAll("table")).toHaveLength(1);
  });

  it("turns Copy and Add consent off, with the reason, for an archived event", async () => {
    renderTab({ withEvent: archivedEvent });
    await listLoaded();

    for (const control of [screen.getByRole("button", { name: "Copy from another event" }), ...screen.getAllByRole("button", { name: "Add consent" })]) {
      expect(isOff(control)).toBe(true);
      expect(document.getElementById(control.getAttribute("aria-describedby") ?? "")?.textContent).toBe("This event is archived. Editing is disabled.");
    }
    // Reading goes on: a text can still be opened, and the button says View.
    expect(isOff(screen.getByRole("button", { name: "View Privacy notice" }))).toBe(false);
    expect(screen.queryByRole("button", { name: "Edit Privacy notice" })).toBeNull();
  });

  it("turns Add consent off at the limit, with the reason, and leaves Copy on", async () => {
    fetchLegalDocuments.mockResolvedValue(answer([privacy, photo, doc("consent-video")]));
    renderTab();
    await listLoaded();

    const add = screen.getByRole("button", { name: "Add consent" });
    expect(isOff(add)).toBe(true);
    expect(document.getElementById(add.getAttribute("aria-describedby") ?? "")?.textContent).toBe("This event has reached its limit of 2 extra consents.");
    expect(isOff(screen.getByRole("button", { name: "Copy from another event" }))).toBe(false);
  });
});

describe("RegistrationLegalTab: opening a text", () => {
  it("reads a text that is stored and shows it in the editor in place of the list, and goes back to the list", async () => {
    renderTab();
    await listLoaded();

    fireEvent.click(screen.getByRole("button", { name: "Edit Privacy notice" }));

    expect(await screen.findByRole("textbox", { name: "Text" })).toBeTruthy();
    expect(fetchLegalDocument).toHaveBeenCalledWith("evt-1", "privacy-notice", expect.any(AbortSignal));
    expect(screen.queryByText("Required texts")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByText("Required texts")).toBeTruthy();
    expect(rowTitles()).toEqual(["Privacy notice", "Event terms"]);
  });

  it("opens a text that has not been written empty, without reading anything", async () => {
    renderTab();
    await listLoaded();

    fireEvent.click(screen.getByRole("button", { name: "Write Event terms" }));

    expect(await screen.findByRole("textbox", { name: "Text" })).toBeTruthy();
    expect((screen.getByRole("textbox", { name: "Title" }) as HTMLInputElement).value).toBe("Event terms");
    expect(fetchLegalDocument).not.toHaveBeenCalled();
  });

  it("opens a new consent with a key to fill in", async () => {
    renderTab();
    await listLoaded();

    fireEvent.click(screen.getAllByRole("button", { name: "Add consent" })[0]!);

    expect(await screen.findByRole("textbox", { name: "Key" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Checkbox label" })).toBeTruthy();
    expect(screen.getByText("Extra consent")).toBeTruthy();
  });

  it("refuses a key the event already has", async () => {
    fetchLegalDocuments.mockResolvedValue(answer([privacy, photo]));
    renderTab();
    await listLoaded();
    fireEvent.click(screen.getAllByRole("button", { name: "Add consent" })[0]!);

    fireEvent.change(await screen.findByRole("textbox", { name: "Key" }), { target: { value: "photo" } });

    expect(screen.getByText("This event already has a consent with this key.")).toBeTruthy();
  });

  it("reads the list again after a save, and shows the new state when the person goes back", async () => {
    saveLegalDocument.mockImplementation(async (_event: string, ref: string, body: { title: string; content_html: string }) => ({
      ...doc(ref, { title: body.title }),
      content_html: body.content_html,
    }));
    renderTab();
    await listLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Write Event terms" }));
    const box = await screen.findByRole("textbox", { name: "Text" });
    fetchLegalDocuments.mockResolvedValue(answer([privacy, doc("event-terms")], []));
    act(() => {
      (box as HTMLElement & { editor: { commands: { setContent: (html: string, options: { emitUpdate: boolean }) => void } } }).editor.commands.setContent("<p>Bring your ticket.</p>", { emitUpdate: true });
    });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(fetchLegalDocuments).toHaveBeenCalledTimes(2));
    // What the checklist needs may have changed with the text: the page reads the checks again, once.
    await waitFor(() => expect(fetchRegistrationSettings).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await screen.findByText("Required texts");
    expect(within(rows()[1]!).getAllByText("Draft")[0]).toBeTruthy();
    expect(screen.queryByText(/Registration cannot be turned on/)).toBeNull();
  });

  it("goes back to the list when the text is deleted, and reads the list again", async () => {
    deleteLegalDocument.mockResolvedValue(undefined);
    renderTab();
    await listLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Edit Privacy notice" }));
    await screen.findByRole("textbox", { name: "Text" });
    fetchLegalDocuments.mockResolvedValue(answer([], [{ ref: "privacy-notice", kind: "privacy_notice", key: null }]));

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));

    await screen.findByText("Required texts");
    await waitFor(() => expect(within(rows()[0]!).getAllByText("Not written")[0]).toBeTruthy());
    expect(deleteLegalDocument).toHaveBeenCalledWith("evt-1", "privacy-notice");
  });

  it("keeps the editor on screen, and asks before another tab is opened, when there are unsaved changes", async () => {
    const { router } = renderTab();
    await listLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Write Event terms" }));
    await screen.findByRole("textbox", { name: "Text" });
    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), { target: { value: "Rules of the event" } });

    fireEvent.click(screen.getByRole("tab", { name: "Checklist" }));

    expect(await screen.findByRole("dialog", { name: "Discard unsaved changes?" })).toBeTruthy();
    expect(router.state.location.search).toBe("?tab=legal");
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(router.state.location.search).toBe("?tab=checklist"));
  });
});

describe("RegistrationLegalTab: the list after a change that could not be read back", () => {
  it("keeps the list and says it may be older, with a Retry", async () => {
    deleteLegalDocument.mockResolvedValue(undefined);
    renderTab();
    await listLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Edit Privacy notice" }));
    await screen.findByRole("textbox", { name: "Text" });
    fetchLegalDocuments.mockRejectedValueOnce(new ApiError(500, "internal_error", "internal_error"));

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));

    const warning = await screen.findByText(/Could not refresh this list, so it may show older details\./);
    expect(warning.closest("[role=alert]")).toBeTruthy();
    expect(rowTitles()).toEqual(["Privacy notice", "Event terms"]);
    fetchLegalDocuments.mockResolvedValue(answer([], [{ ref: "privacy-notice", kind: "privacy_notice", key: null }]));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(within(rows()[0]!).getAllByText("Not written")[0]).toBeTruthy());
  });
});

describe("RegistrationLegalTab: copying from another event", () => {
  it("opens the dialog, and reads the list again and says how many texts were copied when it is done", async () => {
    fetchAdminEvents.mockResolvedValue([event, { id: "evt-2", title: "Autumn Gala", slug: "autumn", archived_at: null } as EventDto]);
    fetchLegalDocuments.mockImplementation(async (eventId: string) =>
      eventId === "evt-2" ? answer([doc("event-terms", { title: "Terms" })]) : answer([privacy], [{ ref: "event-terms", kind: "event_terms", key: null }]),
    );
    fetchLegalDocument.mockImplementation(async (_event: string, ref: string) => withContent(doc(ref)));
    saveLegalDocument.mockResolvedValue(undefined);
    renderTab();
    await listLoaded();

    fireEvent.click(screen.getByRole("button", { name: "Copy from another event" }));
    const dialog = await screen.findByRole("dialog", { name: "Copy legal texts from another event" });
    fireEvent.click(await within(dialog).findByRole("button", { name: /^Copy from, / }));
    fireEvent.click(await screen.findByRole("button", { name: "Autumn Gala" }));
    await within(dialog).findByRole("list", { name: "What will be copied" });
    fetchLegalDocuments.mockImplementation(async (eventId: string) =>
      eventId === "evt-2" ? answer([doc("event-terms")]) : answer([privacy, doc("event-terms")]),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "Copy texts" }));

    await waitFor(() => expect(addToast).toHaveBeenCalledWith("Copied 1 legal text from Autumn Gala.", "success"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(saveLegalDocument).toHaveBeenCalledWith("evt-1", "event-terms", { title: "Event terms", content_html: "<h2>Heading</h2><p>Some words.</p>" });
    await waitFor(() => expect(within(rows()[1]!).getAllByText("Draft")[0]).toBeTruthy());
  });
});

describe("RegistrationLegalTab: what a row does", () => {
  const publishedNow = { published: true, published_at: "2026-10-20T10:00:00.000Z" };
  const terms = doc("event-terms", publishedNow);
  const news = doc("consent-news", { title: "News", ...publishedNow, required: false });
  const asked = doc("consent-photo", { title: "Photos and video", ...publishedNow, required: true });
  const draftConsent = doc("consent-diet", { title: "Diet" });

  async function loaded(items: LegalDocumentDto[], { registrationOn = false, withEvent = event } = {}) {
    fetchRegistrationSettings.mockResolvedValue({ mode: registrationOn ? "approval" : null, guest_url: null, readiness: [], own_address: null });
    fetchLegalDocuments.mockResolvedValue(answer(items));
    renderTab({ withEvent });
    await listLoaded();
    await waitFor(() => expect(fetchRegistrationSettings).toHaveBeenCalled());
  }
  const rowOf = (title: string) => rows().find((row) => row.querySelector(".requirements-item-name")?.textContent === title) as HTMLElement;
  const askedSwitch = (title: string) => within(rowOf(title)).getByRole("switch", { name: `Asked on the form: ${title}` }) as HTMLInputElement;
  const openMenu = (title: string) => fireEvent.click(within(rowOf(title)).getByRole("button", { name: `More actions for ${title}` }));
  const item = (name: string) => screen.getByRole("menuitem", { name: new RegExp(`^${name}`) });

  it("shows the Asked switch on for a published consent the form asks for, off for one it does not, and off with its reason for a draft", async () => {
    await loaded([privacy, terms, asked, news, draftConsent]);

    expect(askedSwitch("Photos and video").checked).toBe(true);
    expect(askedSwitch("News").checked).toBe(false);
    expect(askedSwitch("News").disabled).toBe(false);
    const draft = askedSwitch("Diet");
    expect(draft.checked).toBe(false);
    expect(draft.disabled).toBe(true);
    expect(document.getElementById(draft.getAttribute("aria-describedby") ?? "")?.textContent).toBe("Publish it first.");
  });

  it("shows a draft that the settings still list as asked as off, since only a published consent is asked", async () => {
    await loaded([privacy, terms, doc("consent-old", { title: "Old", required: true })]);

    expect(askedSwitch("Old").checked).toBe(false);
  });

  it("has no Asked switch for the two required texts", async () => {
    await loaded([privacy, terms, news]);

    expect(within(rowOf("Privacy notice")).queryByRole("switch")).toBeNull();
    expect(within(legalPanel()).getAllByRole("switch")).toHaveLength(1);
  });

  it("writes the consents the form asks for when Asked is switched on, keeping the ones it already asks for, and reads the checks again", async () => {
    saveRegistrationSettings.mockResolvedValue({});
    await loaded([privacy, terms, asked, news]);
    const settingsReads = fetchRegistrationSettings.mock.calls.length;

    fireEvent.click(askedSwitch("News"));

    await waitFor(() => expect(saveRegistrationSettings).toHaveBeenCalledWith("evt-1", { consent_keys: ["photo", "news"] }));
    expect(addToast).toHaveBeenCalledWith("The form now asks for this consent.", "success");
    await waitFor(() => expect(fetchLegalDocuments).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(fetchRegistrationSettings.mock.calls.length).toBeGreaterThan(settingsReads));
  });

  it("writes the list without the consent when Asked is switched off", async () => {
    saveRegistrationSettings.mockResolvedValue({});
    await loaded([privacy, terms, asked, news]);

    fireEvent.click(askedSwitch("Photos and video"));

    await waitFor(() => expect(saveRegistrationSettings).toHaveBeenCalledWith("evt-1", { consent_keys: [] }));
    expect(addToast).toHaveBeenCalledWith("The form no longer asks for this consent.", "success");
  });

  it("keeps the switch busy, and does nothing for a second click, while its request runs", async () => {
    const write = deferred<object>();
    saveRegistrationSettings.mockReturnValue(write.promise);
    await loaded([privacy, terms, news, asked]);

    fireEvent.click(askedSwitch("News"));
    await waitFor(() => expect(askedSwitch("News").getAttribute("aria-busy")).toBe("true"));
    fireEvent.click(askedSwitch("Photos and video"));
    expect(saveRegistrationSettings).toHaveBeenCalledTimes(1);

    await act(async () => write.resolve({}));
  });

  it.each([
    [409, "legal_document_in_use", "Registration is on for this event and needs this text. Turn registration off first, then withdraw or delete it."],
    [422, "consent_not_published", "One of the extra consents you chose is not published for this event. Publish its text first, or leave it out."],
    [403, "event_archived", "This event is archived."],
  ])("tells a %i %s in the words of the app, in a toast, and reads the list again", async (status, code, message) => {
    saveRegistrationSettings.mockRejectedValue(new ApiError(status, code, code));
    await loaded([privacy, terms, news]);

    fireEvent.click(askedSwitch("News"));

    await waitFor(() => expect(addToast).toHaveBeenCalledWith(message, "error"));
    await waitFor(() => expect(fetchLegalDocuments).toHaveBeenCalledTimes(2));
  });

  it("says nothing, and sends the browser to sign-in, for a session that ended", async () => {
    saveRegistrationSettings.mockRejectedValue(new ApiError(401, "authentication_required"));
    await loaded([privacy, terms, news]);

    fireEvent.click(askedSwitch("News"));

    await waitFor(() => expect(fetchLegalDocuments).toHaveBeenCalledTimes(2));
    expect(addToast).not.toHaveBeenCalled();
  });

  it("locks every control for an archived event, with the reason, and the menu keeps View as a guest", async () => {
    await loaded([privacy, terms, asked], { withEvent: archivedEvent });

    expect(askedSwitch("Photos and video").disabled).toBe(true);
    openMenu("Photos and video");
    for (const name of ["Unpublish", "Delete"]) {
      expect(isOff(item(name))).toBe(true);
      expect(item(name).textContent).toContain("This event is archived. Editing is disabled.");
    }
    expect(isOff(item("View as a guest"))).toBe(false);
    // The open item of the menu says View too, for the screen on which the button has gone.
    expect(screen.getByRole("menuitem", { name: /^View(?! as a guest)/ })).toBeTruthy();
  });

  it("has Publish for a draft, View as a guest only for a published text, and Delete, in the kebab", async () => {
    await loaded([privacy, terms, draftConsent, news]);

    openMenu("Diet");
    expect(item("Publish")).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /View as a guest/ })).toBeNull();
    expect(item("Delete")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });

    openMenu("News");
    expect(item("Unpublish")).toBeTruthy();
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    fireEvent.click(item("View as a guest"));
    expect(open).toHaveBeenCalledWith("/legal/demo/consent-news", "_blank", "noopener");
    open.mockRestore();
    expect(screen.queryByText(/Public page/)).toBeNull();
  });

  it("says what Delete does to each kind: the privacy notice goes back to Not written, a consent is removed", async () => {
    await loaded([privacy, terms, news]);

    openMenu("Privacy notice");
    expect(item("Delete").textContent).toContain("Back to Not written");
    fireEvent.keyDown(document, { key: "Escape" });
    openMenu("News");
    expect(item("Delete").textContent).toContain("Removes the text and its page");
  });

  it("publishes from the menu, with the item busy, and reads the list again", async () => {
    const answerNow = deferred<LegalDocumentDto>();
    publishLegalDocument.mockReturnValue(answerNow.promise);
    await loaded([privacy, terms, draftConsent]);

    openMenu("Diet");
    fireEvent.click(item("Publish"));
    await waitFor(() => expect(item("Publish").getAttribute("aria-busy")).toBe("true"));
    await act(async () => answerNow.resolve(doc("consent-diet", publishedNow)));

    expect(publishLegalDocument).toHaveBeenCalledWith("evt-1", "consent-diet");
    expect(addToast).toHaveBeenCalledWith("Text published.", "success");
    await waitFor(() => expect(fetchLegalDocuments).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("tells why a publish failed, and keeps the list", async () => {
    publishLegalDocument.mockRejectedValue(new ApiError(500, "unexpected_failure"));
    await loaded([privacy, terms, draftConsent]);

    openMenu("Diet");
    fireEvent.click(item("Publish"));

    await waitFor(() => expect(addToast).toHaveBeenCalledWith("Could not publish this text.", "error"));
  });

  it("asks before it unpublishes, then does, and says so", async () => {
    unpublishLegalDocument.mockResolvedValue(doc("consent-news", { title: "News" }));
    await loaded([privacy, terms, news]);

    openMenu("News");
    fireEvent.click(item("Unpublish"));
    const dialog = await screen.findByRole("dialog", { name: 'Unpublish "News"?' });
    expect(dialog.textContent).toContain("Guests can no longer read it.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Unpublish" }));

    await waitFor(() => expect(unpublishLegalDocument).toHaveBeenCalledWith("evt-1", "consent-news"));
    expect(saveRegistrationSettings).not.toHaveBeenCalled();
    await waitFor(() => expect(addToast).toHaveBeenCalledWith("Text unpublished. Guests can no longer read it.", "success"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("takes a consent the form asks for off the form first, when registration is off, then unpublishes", async () => {
    saveRegistrationSettings.mockResolvedValue({});
    unpublishLegalDocument.mockResolvedValue(doc("consent-photo"));
    await loaded([privacy, terms, asked, news]);

    openMenu("Photos and video");
    fireEvent.click(item("Unpublish"));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Unpublish" }));

    await waitFor(() => expect(unpublishLegalDocument).toHaveBeenCalled());
    expect(saveRegistrationSettings).toHaveBeenCalledWith("evt-1", { consent_keys: [] });
  });

  it("asks before it deletes, and deletes", async () => {
    deleteLegalDocument.mockResolvedValue(undefined);
    await loaded([privacy, terms, news]);

    openMenu("News");
    fireEvent.click(item("Delete"));
    const dialog = await screen.findByRole("dialog", { name: 'Delete "News"?' });
    expect(dialog.textContent).toContain("Its page stops working. This cannot be undone.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(deleteLegalDocument).toHaveBeenCalledWith("evt-1", "consent-news"));
    await waitFor(() => expect(addToast).toHaveBeenCalledWith("Text deleted.", "success"));
  });

  it("keeps the delete dialog open with the reason when the server refuses, and Cancel closes it", async () => {
    deleteLegalDocument.mockRejectedValue(new ApiError(409, "legal_document_in_use", "legal_document_in_use"));
    await loaded([privacy, terms, news]);

    openMenu("News");
    fireEvent.click(item("Delete"));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    expect((await within(dialog).findByText(/Registration is on for this event/))).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("blocks Unpublish and Delete of the texts registration needs while it is on, with the reason as tooltip and as visible text", async () => {
    await loaded([privacy, terms, asked, news], { registrationOn: true });
    await waitFor(() => {
      openMenu("Privacy notice");
      expect(isOff(item("Unpublish"))).toBe(true);
    });

    expect(item("Unpublish").textContent).toContain("Registration is on. Turn it off first.");
    expect(isOff(item("Delete"))).toBe(true);
    expect(getTooltipText(item("Delete"))).toBe("Registration is on. Turn it off first.");
    fireEvent.keyDown(document, { key: "Escape" });

    openMenu("Photos and video");
    expect(isOff(item("Unpublish"))).toBe(true);
    expect(item("Delete").textContent).toContain("The form asks for it. Switch off Asked first.");
    fireEvent.keyDown(document, { key: "Escape" });

    // A consent the form does not ask for is free, and so is its switch.
    openMenu("News");
    expect(isOff(item("Unpublish"))).toBe(false);
    expect(isOff(item("Delete"))).toBe(false);
    expect(askedSwitch("Photos and video").disabled).toBe(false);
  });

  it("opens the text from the menu too, for the screen where the Edit button has gone", async () => {
    await loaded([privacy, terms, news]);

    openMenu("News");
    fireEvent.click(item("Edit"));

    expect(await screen.findByRole("textbox", { name: "Checkbox label" })).toBeTruthy();
  });
});
