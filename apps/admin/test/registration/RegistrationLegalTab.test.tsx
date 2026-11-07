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
import { advanceTimers, deferred, hangUntilAborted, isOff } from "../test-utils.js";
import { LEGAL_LIMITS, legalDoc, legalDocWithContent } from "./legalFixtures.js";
import { stubProseMirrorLayout } from "./proseMirrorJsdom.js";

const fetchLegalDocuments = vi.fn();
const fetchLegalDocument = vi.fn();
const saveLegalDocument = vi.fn();
const publishLegalDocument = vi.fn();
const deleteLegalDocument = vi.fn();
const fetchAdminEvents = vi.fn();

vi.mock("../../src/api/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/api/client.js")>()),
  fetchLegalDocuments: (...args: unknown[]) => fetchLegalDocuments(...args),
  fetchLegalDocument: (...args: unknown[]) => fetchLegalDocument(...args),
  saveLegalDocument: (...args: unknown[]) => saveLegalDocument(...args),
  publishLegalDocument: (...args: unknown[]) => publishLegalDocument(...args),
  deleteLegalDocument: (...args: unknown[]) => deleteLegalDocument(...args),
  fetchAdminEvents: (...args: unknown[]) => fetchAdminEvents(...args),
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
const rows = () => within(legalPanel()).getAllByRole("listitem").filter((item) => item.classList.contains("legal-row"));
const rowTitles = () => rows().map((row) => row.querySelector(".legal-row__title")?.textContent);

/** Waits until the list is on screen: the placeholder draws the card's title too, so the title alone is not the answer. */
async function listLoaded() {
  await waitFor(() => expect(placeholder()).toBeNull());
  await screen.findByText("Legal texts");
}

beforeAll(() => {
  stubProseMirrorLayout();
});

beforeEach(() => {
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
    expect(within(held).getByText("Legal texts")).toBeTruthy();
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
  it("shows the privacy notice and the terms first, whether they are written or not, then the consents", async () => {
    fetchLegalDocuments.mockResolvedValue(answer([privacy, photo]));
    renderTab();
    await listLoaded();

    expect(rowTitles()).toEqual(["Privacy notice", "Event terms", "Photos and video"]);
    const [noticeRow, termsRow, consentRow] = rows();
    expect(within(noticeRow!).getByText("Published")).toBeTruthy();
    expect(within(termsRow!).getByText("Not written")).toBeTruthy();
    expect(within(consentRow!).getByText("Draft")).toBeTruthy();
    expect(within(noticeRow!).getByRole("button", { name: "Edit Privacy notice" })).toBeTruthy();
    expect(within(termsRow!).getByRole("button", { name: "Write Event terms" })).toBeTruthy();
    expect(noticeRow!.textContent).toContain("needed before registration can be turned on");
    expect(consentRow!.textContent).toContain("Extra consent, key photo, asked on the form");
  });

  it("links a published text to its public page in a new tab, and a draft to nothing", async () => {
    fetchLegalDocuments.mockResolvedValue(answer([privacy, photo]));
    renderTab();
    await listLoaded();

    const links = within(legalPanel()).getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]!.getAttribute("href")).toBe("/legal/demo/privacy-notice");
    expect(links[0]!.getAttribute("target")).toBe("_blank");
    expect(links[0]!.getAttribute("rel")).toBe("noopener noreferrer");
    expect(links[0]!.textContent).toContain("of Privacy notice (opens in a new tab)");
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

  it("turns Copy and Add consent off, with the reason, for an archived event", async () => {
    renderTab({ withEvent: archivedEvent });
    await listLoaded();

    for (const name of ["Copy from another event", "Add consent"]) {
      const control = screen.getByRole("button", { name });
      expect(isOff(control)).toBe(true);
      expect(document.getElementById(control.getAttribute("aria-describedby") ?? "")?.textContent).toBe("This event is archived. Editing is disabled.");
    }
    // Reading goes on: a text can still be opened.
    expect(isOff(screen.getByRole("button", { name: "Edit Privacy notice" }))).toBe(false);
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
    expect(screen.queryByText("Legal texts")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back to legal texts" }));
    expect(await screen.findByText("Legal texts")).toBeTruthy();
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

    fireEvent.click(screen.getByRole("button", { name: "Add consent" }));

    expect(await screen.findByRole("textbox", { name: "Key" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Checkbox label" })).toBeTruthy();
    expect(screen.getByText("Extra consent")).toBeTruthy();
  });

  it("refuses a key the event already has", async () => {
    fetchLegalDocuments.mockResolvedValue(answer([privacy, photo]));
    renderTab();
    await listLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Add consent" }));

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
    fireEvent.click(screen.getByRole("button", { name: "Back to legal texts" }));
    await screen.findByText("Legal texts");
    expect(within(rows()[1]!).getByText("Draft")).toBeTruthy();
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

    await screen.findByText("Legal texts");
    await waitFor(() => expect(within(rows()[0]!).getByText("Not written")).toBeTruthy());
    expect(deleteLegalDocument).toHaveBeenCalledWith("evt-1", "privacy-notice");
  });

  it("keeps the editor on screen, and asks before another tab is opened, when there are unsaved changes", async () => {
    const { router } = renderTab();
    await listLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Write Event terms" }));
    await screen.findByRole("textbox", { name: "Text" });
    fireEvent.change(screen.getByRole("textbox", { name: "Title" }), { target: { value: "Rules of the event" } });

    fireEvent.click(screen.getByRole("tab", { name: "Access" }));

    expect(await screen.findByRole("dialog", { name: "Discard unsaved changes?" })).toBeTruthy();
    expect(router.state.location.search).toBe("?tab=legal");
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(router.state.location.search).toBe("?tab=access"));
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
    await waitFor(() => expect(within(rows()[0]!).getByText("Not written")).toBeTruthy());
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
    await waitFor(() => expect(within(rows()[1]!).getByText("Draft")).toBeTruthy());
  });
});
