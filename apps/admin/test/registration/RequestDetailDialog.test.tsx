// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/api/client.js";
import type { EventCustomFieldDto, EventDto, RegistrationDetailDto, RetryRegistrationMailsDto } from "../../src/api/types.js";
import { formatUtcDateTime } from "../../src/utils/event-dates.js";
import { SLOW_NOTICE_TEXT } from "../../src/utils/loading-timing.js";
import { advanceTimers, deferred, getTooltipText, hangUntilAborted, isOff, mockMatchMedia } from "../test-utils.js";
import { FakeServer, api, resetApi } from "./requestsApi.js";
import { EVENT, FAILED_MAIL, answer, detail, mailRow, named, openButton, openIds, renderTab, request, requestsPanel } from "./requestsFixtures.js";

vi.mock("../../src/api/client.js", async () => (await import("./requestsApi.js")).mockedClient());
vi.mock("../../src/connection/ConnectionStateProvider.js");
vi.mock("../../src/auth/login-navigation.js", async () => (await import("./requestsApi.js")).loginNavigationModule());
vi.mock("../../src/registration/RegistrationFieldsTab.js", async () => (await import("./requestsApi.js")).fieldsTabModule());
vi.mock("../../src/registration/RegistrationLegalTab.js", async () => (await import("./requestsApi.js")).legalTabModule());

const EVERY_STATE = "?tab=requests&status=all";
const QUEUE = "?tab=requests&status=pending";
const ARCHIVED = { ...EVENT, archived_at: "2026-10-01T00:00:00.000Z" } as EventDto;
const utc = formatUtcDateTime;

const field = (source_field: string, label: string, type: EventCustomFieldDto["type"] = "text"): EventCustomFieldDto => ({
  id: `f-${source_field}`,
  source_field,
  label,
  description: null,
  type,
  required: false,
  show_on_form: true,
  display_order: 0,
  options: null,
  rules: null,
  created_at: "2026-10-01T00:00:00.000Z",
});

const rows = () => [named("r1", "Ann", "Kowalska", { company: "Northwind" }), named("r2", "Bo", "Lee"), named("r3", "Cy", "Park")];

const loaded = () => screen.findByRole("table", { name: "Requests" });
/** The window of a request, once it is open and has its header. */
const windowOf = (name: string) => screen.findByRole("dialog", { name });
async function openRequest(id: string, name: string): Promise<HTMLElement> {
  fireEvent.click(openButton(id) as HTMLElement);
  return windowOf(name);
}
/** The value that stands under a label in the window. */
const valueOf = (box: HTMLElement, label: string) => within(box).getByText(label, { selector: "dt" }).parentElement?.querySelector("dd")?.textContent;
const press = (box: HTMLElement, name: string | RegExp) => fireEvent.click(within(box).getByRole("button", { name }));
const checkbox = (name: string) => screen.getByRole("checkbox", { name: `Select ${name}` });

beforeEach(() => {
  mockMatchMedia(true);
  resetApi();
  new FakeServer(rows());
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("opening a request", () => {
  it("opens it from the button that holds the guest, with the guest's name and address in the header at once, before the rest is read", async () => {
    const record = deferred<RegistrationDetailDto>();
    api.fetchRegistration.mockReturnValue(record.promise);
    renderTab({ search: EVERY_STATE });
    await loaded();

    const box = await openRequest("r1", "Ann Kowalska");

    expect(within(box).getByRole("heading", { name: "Ann Kowalska" })).toBeTruthy();
    expect(box.textContent).toContain("r1@example.com");
    // The decisions that need nothing from the record are there too, so that a slow read does not hold the queue up.
    expect(within(box).getByRole("button", { name: "Accept" })).toBeTruthy();
    expect(within(box).getByRole("button", { name: "Reject" })).toBeTruthy();
    expect(within(box).getByRole("button", { name: "Delete" })).toBeTruthy();
    expect(within(box).getByRole("button", { name: "Close" })).toBeTruthy();
    await act(async () => record.resolve(detail("r1")));
    expect(await within(box).findByText("Request")).toBeTruthy();
    expect(api.fetchRegistration).toHaveBeenCalledWith("evt-1", "r1", expect.any(AbortSignal));
  });

  it("is a button a keyboard reaches: it names the guest and says that it opens a window", async () => {
    renderTab({ search: EVERY_STATE });
    await loaded();

    const button = openButton("r1") as HTMLElement;

    expect(button.tagName).toBe("BUTTON");
    expect(button.getAttribute("aria-haspopup")).toBe("dialog");
    expect(button.textContent).toContain("Ann Kowalska");
  });

  it("opens the request of the card on a narrow screen as well", async () => {
    mockMatchMedia(false);
    renderTab({ search: EVERY_STATE });
    await screen.findByRole("list", { name: "Requests" });

    const box = await openRequest("r2", "Bo Lee");

    expect(within(box).getByRole("button", { name: "Accept" })).toBeTruthy();
  });

  it("draws nothing for 200ms, then the sections it will have, then says it takes longer after 8 seconds", async () => {
    vi.useFakeTimers();
    api.fetchRegistration.mockImplementation(hangUntilAborted as never);
    renderTab({ search: EVERY_STATE });
    await advanceTimers(0);
    await advanceTimers(0);
    fireEvent.click(openButton("r1") as HTMLElement);
    await advanceTimers(0);

    const box = screen.getByRole("dialog", { name: "Ann Kowalska" });
    expect(box.querySelector(".at-loading-hold")).not.toBeNull();
    expect(within(box).getByRole("status", { name: "Loading request" })).toBeTruthy();
    expect(within(box).queryByText(SLOW_NOTICE_TEXT)).toBeNull();

    await advanceTimers(200);
    expect(box.querySelector(".at-loading-hold")).toBeNull();
    expect(within(box).getByText("Request", { selector: "h3" })).toBeTruthy();
    expect(within(box).getByText("Emails", { selector: "h3" })).toBeTruthy();

    await advanceTimers(8000);
    expect(within(box).getByText(SLOW_NOTICE_TEXT)).toBeTruthy();
  });
});

describe("what a request says", () => {
  it("lists the request: its state, when it was sent and decided and by whom, the address check, the terms and the company, each time in UTC", async () => {
    api.fetchRegistration.mockResolvedValue(
      detail("r1", {
        status: "accepted",
        company: "Northwind Ltd",
        department: "Marketing",
        locale: "en",
        decided_at: "2026-10-23T12:30:00.000Z",
        decided_by: { id: "u1", name: "Pat Organiser" },
        attendee_id: "at-1",
      }),
    );
    renderTab({ search: EVERY_STATE });
    await loaded();

    const box = await openRequest("r1", "Ann Kowalska");
    await within(box).findByText("Request");

    expect(valueOf(box, "Status")).toBe("Accepted");
    expect(valueOf(box, "Sent")).toBe(utc("2026-10-23T10:14:00.000Z"));
    expect(valueOf(box, "Company")).toBe("Northwind Ltd");
    expect(valueOf(box, "Department")).toBe("Marketing");
    expect(valueOf(box, "Address confirmed")).toBe(utc("2026-10-23T10:16:00.000Z"));
    expect(valueOf(box, "Terms accepted")).toBe(utc("2026-10-23T10:14:00.000Z"));
    expect(valueOf(box, "Decision")).toBe(`${utc("2026-10-23T12:30:00.000Z")} by Pat Organiser`);
    expect(valueOf(box, "Language")).toBe("en");
  });

  it("leaves out what the request does not have: no company, no department, no language, and an automatic decision has no one who decided", async () => {
    api.fetchRegistration.mockResolvedValue(detail("r1", { decided_at: "2026-10-23T12:30:00.000Z", decided_by: null }));
    renderTab({ search: EVERY_STATE });
    await loaded();

    const box = await openRequest("r1", "Ann Kowalska");
    await within(box).findByText("Request");

    expect(within(box).queryByText("Company", { selector: "dt" })).toBeNull();
    expect(within(box).queryByText("Department", { selector: "dt" })).toBeNull();
    expect(within(box).queryByText("Language", { selector: "dt" })).toBeNull();
    expect(valueOf(box, "Decision")).toBe(utc("2026-10-23T12:30:00.000Z"));
  });

  it("says a decision that was not made is a dash, and terms that were not accepted as well", async () => {
    api.fetchRegistration.mockResolvedValue(detail("r1", { accepted_at: null }));
    renderTab({ search: EVERY_STATE });
    await loaded();

    const box = await openRequest("r1", "Ann Kowalska");
    await within(box).findByText("Request");

    expect(valueOf(box, "Decision")).toBe("-");
    expect(valueOf(box, "Terms accepted")).toBe("-");
  });

  it("says what the address check came to: confirmed, still waited for, or never asked for", async () => {
    renderTab({ search: EVERY_STATE });
    await loaded();

    api.fetchRegistration.mockResolvedValue(detail("r1", { status: "awaiting_email", email_verified_at: null, confirm_expires_at: "2026-10-24T10:14:00.000Z" }));
    let box = await openRequest("r1", "Ann Kowalska");
    await within(box).findByText("Request");
    expect(valueOf(box, "Address confirmed")).toBe(`Not confirmed yet. The link works until ${utc("2026-10-24T10:14:00.000Z")}.`);
    fireEvent.click(within(box).getByRole("button", { name: "Close" }));

    api.fetchRegistration.mockResolvedValue(detail("r2", { email_verified_at: null, confirm_expires_at: null }));
    box = await openRequest("r2", "Bo Lee");
    await within(box).findByText("Request");
    expect(valueOf(box, "Address confirmed")).toBe("Not checked");
  });

  it("names the answers by the questions of the event, and writes each as its answer: Yes for a tick, the day and time at the event for a date and time", async () => {
    api.fetchEventCustomFields.mockResolvedValue([
      field("parking_plate", "Parking plate"),
      field("needs_shuttle", "Needs the shuttle", "boolean"),
      field("arrival", "Arrival (at the event)", "datetime"),
    ]);
    api.fetchRegistration.mockResolvedValue(
      detail("r1", { custom_data: { parking_plate: "WX 12345", needs_shuttle: "true", arrival: "2026-11-19T21:30", unknown_field: "kept" } }),
    );
    renderTab({ search: EVERY_STATE });
    await loaded();

    const box = await openRequest("r1", "Ann Kowalska");
    await within(box).findByText("Answers");

    expect(valueOf(box, "Parking plate")).toBe("WX 12345");
    expect(valueOf(box, "Needs the shuttle")).toBe("Yes");
    // The time the guest gave is the time at the event, and says in which zone: the staff member's own zone does not come into it.
    expect(valueOf(box, "Arrival (at the event)")).toMatch(/2026/);
    expect(valueOf(box, "Arrival (at the event)")).toMatch(/9:30|09:30|21:30/);
    expect(valueOf(box, "Arrival (at the event)")).toContain("(Europe/Warsaw)");
    // An answer to a question the event no longer has is shown by its key, made readable, and not dropped.
    expect(valueOf(box, "Unknown field")).toBe("kept");
  });

  it("gives a long answer the whole row, and has no section of answers when there are none", async () => {
    api.fetchEventCustomFields.mockResolvedValue([field("notes", "Anything we should know?", "long_text")]);
    api.fetchRegistration.mockResolvedValue(detail("r1", { custom_data: { notes: "word ".repeat(40) } }));
    renderTab({ search: EVERY_STATE });
    await loaded();

    const box = await openRequest("r1", "Ann Kowalska");
    await within(box).findByText("Answers");
    expect(within(box).getByText("Anything we should know?", { selector: "dt" }).parentElement?.classList.contains("request-detail__wide")).toBe(true);
    fireEvent.click(within(box).getByRole("button", { name: "Close" }));

    api.fetchRegistration.mockResolvedValue(detail("r2", { custom_data: null }));
    const second = await openRequest("r2", "Bo Lee");
    await within(second).findByText("Request");
    expect(within(second).queryByText("Answers")).toBeNull();
  });

  it("names the extra consents by their titles, and says when each was given", async () => {
    api.fetchLegalDocuments.mockResolvedValue({
      items: [
        { id: "d1", ref: "consent-marketing", kind: "consent", key: "marketing", title: "Marketing emails and event news", published: true, published_at: null, updated_at: "2026-10-01T00:00:00.000Z", public_path: "/legal/demo/consent-marketing", required: false },
        { id: "d2", ref: "privacy-notice", kind: "privacy_notice", key: null, title: "Privacy notice", published: true, published_at: null, updated_at: "2026-10-01T00:00:00.000Z", public_path: "/legal/demo/privacy-notice", required: true },
      ],
      missing: [],
      limits: { title_chars: 200, content_chars: 100_000, consents: 10 },
    });
    api.fetchRegistration.mockResolvedValue(detail("r1", { consents: { marketing: "2026-10-23T10:14:00.000Z", partners_news: "2026-10-23T10:14:30.000Z" } }));
    renderTab({ search: EVERY_STATE });
    await loaded();

    const box = await openRequest("r1", "Ann Kowalska");
    await within(box).findByText("Consents");

    expect(valueOf(box, "Marketing emails and event news")).toBe(`Given ${utc("2026-10-23T10:14:00.000Z")}`);
    // A consent the event no longer has a text for is named by its key.
    expect(valueOf(box, "Partners news")).toBe(`Given ${utc("2026-10-23T10:14:30.000Z")}`);
  });

  it("shows the person the guest brings: their name and their answers", async () => {
    api.fetchEventCustomFields.mockResolvedValue([field("diet", "Diet")]);
    api.fetchRegistration.mockResolvedValue(detail("r1", { companions: [{ name: "Wiktoria Kowalska", custom_data: { diet: "Vegan" } }] }));
    renderTab({ search: EVERY_STATE });
    await loaded();

    const box = await openRequest("r1", "Ann Kowalska");
    await within(box).findByText("Companion");

    expect(valueOf(box, "Name")).toBe("Wiktoria Kowalska");
    expect(valueOf(box, "Diet")).toBe("Vegan");
  });

  it("numbers the companions when there are several, and shows one without answers as a name only", async () => {
    api.fetchRegistration.mockResolvedValue(
      detail("r1", {
        companions: [
          { name: "First Person", custom_data: null },
          { name: "Second Person", custom_data: null },
        ],
      }),
    );
    renderTab({ search: EVERY_STATE });
    await loaded();

    const box = await openRequest("r1", "Ann Kowalska");

    expect(await within(box).findByText("Companion 1")).toBeTruthy();
    expect(within(box).getByText("Companion 2")).toBeTruthy();
    expect(within(box).getByText("Second Person")).toBeTruthy();
  });

  it("opens with the keys of the answers, made readable, when the questions could not be read, and reads them again the next time", async () => {
    api.fetchEventCustomFields.mockRejectedValueOnce(new ApiError(500, "boom", "internal_error"));
    api.fetchRegistration.mockResolvedValue(detail("r1", { custom_data: { parking_plate: "WX 12345" } }));
    renderTab({ search: EVERY_STATE });
    await loaded();

    let box = await openRequest("r1", "Ann Kowalska");
    await within(box).findByText("Answers");
    expect(valueOf(box, "Parking plate")).toBe("WX 12345");
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(within(box).getByRole("button", { name: "Close" }));

    api.fetchEventCustomFields.mockResolvedValue([field("parking_plate", "Where the car stands")]);
    api.fetchRegistration.mockResolvedValue(detail("r2", { custom_data: { parking_plate: "KR 1" } }));
    box = await openRequest("r2", "Bo Lee");
    await within(box).findByText("Answers");
    expect(valueOf(box, "Where the car stands")).toBe("KR 1");
    expect(api.fetchEventCustomFields).toHaveBeenCalledTimes(2);
  });

  it("names the consents by their keys, made readable, when the texts could not be read, and reads them again the next time", async () => {
    api.fetchLegalDocuments.mockRejectedValueOnce(new ApiError(500, "boom", "internal_error"));
    api.fetchRegistration.mockResolvedValue(detail("r1", { consents: { marketing: "2026-10-23T10:14:00.000Z" } }));
    renderTab({ search: EVERY_STATE });
    await loaded();

    let box = await openRequest("r1", "Ann Kowalska");
    await within(box).findByText("Consents");
    expect(valueOf(box, "Marketing")).toBe(`Given ${utc("2026-10-23T10:14:00.000Z")}`);
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(within(box).getByRole("button", { name: "Close" }));

    api.fetchRegistration.mockResolvedValue(detail("r2", { consents: { marketing: "2026-10-23T11:00:00.000Z" } }));
    box = await openRequest("r2", "Bo Lee");
    await within(box).findByText("Consents");
    expect(api.fetchLegalDocuments).toHaveBeenCalledTimes(2);
  });

  it("reads the questions and the texts once for the tab, and not for each request that is opened", async () => {
    api.fetchRegistration.mockImplementation(async (_event: string, id: string) => detail(id));
    renderTab({ search: EVERY_STATE });
    await loaded();

    let box = await openRequest("r1", "Ann Kowalska");
    await within(box).findByText("Request");
    fireEvent.click(within(box).getByRole("button", { name: "Close" }));
    box = await openRequest("r2", "Bo Lee");
    await within(box).findByText("Request");

    expect(api.fetchRegistration).toHaveBeenCalledTimes(2);
    expect(api.fetchEventCustomFields).toHaveBeenCalledTimes(1);
    expect(api.fetchLegalDocuments).toHaveBeenCalledTimes(1);
  });
});

describe("the emails of a request", () => {
  it("lists them as they were sent, with what each was, how it went and when", async () => {
    api.fetchRegistration.mockResolvedValue(
      detail("r1", {
        mails: [
          mailRow("m1", { template_name: "registration-confirm", status: "sent", sent_at: "2026-10-23T10:15:00.000Z" }),
          mailRow("m2", { template_name: "registration-received", status: "queued", attempts: 0, attempted_at: null, sent_at: null, queued_at: "2026-10-23T10:20:00.000Z" }),
          mailRow("m3", { template_name: "registration-waitlist", status: "failed", retryable: true, attempts: 3, sent_at: null, attempted_at: "2026-10-23T10:30:00.000Z", error_code: "smtp_rejected", error: "The mail server did not accept the message." }),
        ],
      }),
    );
    renderTab({ search: EVERY_STATE });
    await loaded();

    const box = await openRequest("r1", "Ann Kowalska");
    await within(box).findByText("Emails");

    const items = within(box).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]?.textContent).toContain("Address confirmation");
    expect(items[0]?.textContent).toContain("Sent");
    expect(items[0]?.textContent).toContain(`Sent ${utc("2026-10-23T10:15:00.000Z")}`);
    // One try is the normal case and goes unsaid; only more than one is told.
    expect(items[0]?.textContent).not.toContain("attempt");
    expect(items[1]?.textContent).toContain("Request received");
    expect(items[1]?.textContent).toContain("Pending");
    expect(items[1]?.textContent).toContain(`Queued ${utc("2026-10-23T10:20:00.000Z")}`);
    // A failed email that the worker still tries by itself is not final, and says so, with what went wrong and how often it was tried.
    expect(items[2]?.textContent).toContain("Retrying");
    expect(items[2]?.textContent).toContain(`Last tried ${utc("2026-10-23T10:30:00.000Z")}. 3 attempts`);
    expect(items[2]?.textContent).toContain("The mail server did not accept the message.");
  });

  it("says that no email was queued when none was", async () => {
    api.fetchRegistration.mockResolvedValue(detail("r1", { mails: [] }));
    renderTab({ search: EVERY_STATE });
    await loaded();

    const box = await openRequest("r1", "Ann Kowalska");

    expect(await within(box).findByText("No email was queued for this guest.")).toBeTruthy();
  });

  it("does not show the error of an email that went out, whatever an earlier try left behind", async () => {
    api.fetchRegistration.mockResolvedValue(detail("r1", { mails: [mailRow("m1", { status: "sent", error: "An earlier try failed." })] }));
    renderTab({ search: EVERY_STATE });
    await loaded();

    const box = await openRequest("r1", "Ann Kowalska");
    await within(box).findByText("Emails");

    expect(box.textContent).not.toContain("An earlier try failed.");
  });

  it("offers to send the last email again when the server says it can be, sends it, closes the window, tells what was queued, and the keyboard comes back to the request", async () => {
    new FakeServer([named("r1", "Ann", "Kowalska", { last_mail: FAILED_MAIL }), named("r2", "Bo", "Lee")]);
    api.fetchRegistration.mockResolvedValue(
      detail("r1", { mails: [mailRow("m1", { status: "failed", retryable: false, can_retry: true, error: "The mail server did not accept the message.", error_code: "smtp_rejected" })] }),
    );
    renderTab({ search: EVERY_STATE });
    await loaded();

    const box = await openRequest("r1", "Ann Kowalska");
    const again = await within(box).findByRole("button", { name: "Send again" });
    again.focus();
    fireEvent.click(again);

    expect(await screen.findByText("1 email will be sent again.")).toBeTruthy();
    expect(api.retryRegistrationMails).toHaveBeenCalledWith("evt-1", ["r1"]);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(openButton("r1")));
  });

  it("shows that sending again works for as long as the server takes, and sends it once however often the button is pressed", async () => {
    new FakeServer([named("r1", "Ann", "Kowalska", { last_mail: FAILED_MAIL })]);
    const reply = deferred<RetryRegistrationMailsDto>();
    api.retryRegistrationMails.mockReturnValue(reply.promise);
    api.fetchRegistration.mockResolvedValue(detail("r1", { mails: [mailRow("m1", { status: "failed", retryable: false, can_retry: true })] }));
    renderTab({ search: EVERY_STATE });
    await loaded();
    const box = await openRequest("r1", "Ann Kowalska");
    const again = await within(box).findByRole("button", { name: "Send again" });

    fireEvent.click(again);
    fireEvent.click(again);

    expect(api.retryRegistrationMails).toHaveBeenCalledTimes(1);
    expect(again.getAttribute("aria-busy")).toBe("true");
    await act(async () => reply.resolve({ results: [{ id: "r1", outcome: "retried" }] }));
    expect(await screen.findByText("1 email will be sent again.")).toBeTruthy();
  });

  it("says in the window, beside the button, that the email could not be sent again, keeps the window, and says it no more once the button is pressed again", async () => {
    new FakeServer([named("r1", "Ann", "Kowalska", { last_mail: FAILED_MAIL })]);
    api.fetchRegistration.mockResolvedValue(detail("r1", { mails: [mailRow("m1", { status: "failed", retryable: false, can_retry: true })] }));
    api.retryRegistrationMails.mockRejectedValueOnce(new ApiError(500, "boom", "internal_error"));
    renderTab({ search: EVERY_STATE });
    await loaded();
    const box = await openRequest("r1", "Ann Kowalska");
    const again = await within(box).findByRole("button", { name: "Send again" });

    fireEvent.click(again);

    const failure = "Something went wrong. Try again. If it keeps happening, check System logs.";
    expect((await within(box).findByRole("alert")).textContent).toBe(failure);
    // Said once, in the window: not as a toast as well.
    expect(screen.getAllByText(failure)).toHaveLength(1);
    expect(screen.getByRole("dialog", { name: "Ann Kowalska" })).toBe(box);

    const reply = deferred<RetryRegistrationMailsDto>();
    api.retryRegistrationMails.mockReturnValueOnce(reply.promise);
    fireEvent.click(again);
    expect(within(box).queryByRole("alert")).toBeNull();
    await act(async () => reply.resolve({ results: [{ id: "r1", outcome: "retried" }] }));
    expect(await screen.findByText("1 email will be sent again.")).toBeTruthy();
  });

  it("offers it for the last email only, and only when that one can be sent again", async () => {
    api.fetchRegistration.mockResolvedValue(
      detail("r1", {
        mails: [mailRow("m1", { status: "failed", retryable: false, can_retry: true }), mailRow("m2", { status: "sent", can_retry: false })],
      }),
    );
    renderTab({ search: EVERY_STATE });
    await loaded();

    const box = await openRequest("r1", "Ann Kowalska");
    await within(box).findByText("Emails");

    expect(within(box).queryByRole("button", { name: "Send again" })).toBeNull();
  });

  it("does not offer to send a failed ticket from here: the ticket is sent again from the attendee, with the way to that page", async () => {
    api.fetchRegistration.mockResolvedValue(
      detail("r1", {
        status: "accepted",
        attendee_id: "at-1",
        mails: [mailRow("m1", { template_name: "ticket", status: "failed", retryable: false, can_retry: false, error: "The mail server did not accept the message." })],
      }),
    );
    const { router } = renderTab({ search: EVERY_STATE });
    await loaded();

    const box = await openRequest("r1", "Ann Kowalska");
    await within(box).findByText("Emails");

    expect(within(box).queryByRole("button", { name: "Send again" })).toBeNull();
    const mailRowItem = within(box).getAllByRole("listitem")[0] as HTMLElement;
    expect(mailRowItem.textContent).toContain("The ticket is sent again from the attendee's page.");
    const link = within(mailRowItem).getByRole("link", { name: "Open attendee" });
    expect(link.getAttribute("href")).toBe("/admin/events/evt-1/attendees/at-1");

    fireEvent.click(link);

    await waitFor(() => expect(router.state.location.pathname).toBe("/admin/events/evt-1/attendees/at-1"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("says nothing of the way to the attendee for a failed email that is not the ticket, even when the request has an attendee", async () => {
    api.fetchRegistration.mockResolvedValue(
      detail("r1", { status: "accepted", attendee_id: "at-1", mails: [mailRow("m1", { status: "failed", retryable: false, can_retry: false })] }),
    );
    renderTab({ search: EVERY_STATE });
    await loaded();

    const box = await openRequest("r1", "Ann Kowalska");
    await within(box).findByText("Emails");

    expect(box.textContent).not.toContain("attendee's page");
    expect(within(within(box).getAllByRole("listitem")[0] as HTMLElement).queryByRole("link")).toBeNull();
  });

  it("says nothing of it for a ticket that went out, and nothing for a failed ticket of a request that has no attendee", async () => {
    api.fetchRegistration.mockResolvedValue(
      detail("r1", { status: "accepted", attendee_id: "at-1", mails: [mailRow("m1", { template_name: "ticket", status: "sent" })] }),
    );
    renderTab({ search: EVERY_STATE });
    await loaded();
    const sent = await openRequest("r1", "Ann Kowalska");
    await within(sent).findByText("Emails");
    expect(sent.textContent).not.toContain("attendee's page");

    cleanup();
    api.fetchRegistration.mockResolvedValue(
      detail("r1", { status: "accepted", attendee_id: null, mails: [mailRow("m1", { template_name: "ticket", status: "failed", retryable: false, can_retry: false })] }),
    );
    renderTab({ search: EVERY_STATE });
    await loaded();
    const failed = await openRequest("r1", "Ann Kowalska");
    await within(failed).findByText("Emails");
    expect(failed.textContent).not.toContain("attendee's page");
    expect(within(failed).queryByRole("link", { name: "Open attendee" })).toBeNull();
  });

  it("counts a ticket that bounced, or that the server refused, as failed: the way to the attendee, and what went wrong", async () => {
    api.fetchRegistration.mockResolvedValue(
      detail("r1", {
        status: "accepted",
        attendee_id: "at-1",
        mails: [
          mailRow("m1", { template_name: "ticket", status: "bounced", error: "The guest's mail server sent it back." }),
          mailRow("m2", { template_name: "ticket", status: "rejected", error: "The mail server refused the message." }),
        ],
      }),
    );
    renderTab({ search: EVERY_STATE });
    await loaded();

    const box = await openRequest("r1", "Ann Kowalska");
    await within(box).findByText("Emails");

    const [bounced, refused] = within(box).getAllByRole("listitem") as [HTMLElement, HTMLElement];
    expect(bounced.textContent).toContain("The guest's mail server sent it back.");
    expect(within(bounced).getByRole("link", { name: "Open attendee" })).toBeTruthy();
    expect(refused.textContent).toContain("The mail server refused the message.");
    expect(within(refused).getByRole("link", { name: "Open attendee" })).toBeTruthy();
  });
});

describe("the decisions of the window", () => {
  it.each([
    ["pending", ["Accept", "Reject", "Delete"], []],
    ["waitlist", ["Accept", "Reject", "Delete"], []],
    ["rejected", ["Accept", "Delete"], ["Reject"]],
    ["accepted", ["Delete", "Open attendee"], ["Accept", "Reject"]],
    ["awaiting_email", ["Delete"], ["Accept", "Reject"]],
  ] as const)("offers a request that is %s exactly what can be done to it", async (status, offered, notOffered) => {
    new FakeServer([named("r1", "Ann", "Kowalska", { status })]);
    api.fetchRegistration.mockResolvedValue(detail("r1", { status, attendee_id: status === "accepted" ? "at-1" : null }));
    renderTab({ search: EVERY_STATE });
    await loaded();

    const box = await openRequest("r1", "Ann Kowalska");
    await within(box).findByText("Request");

    for (const name of offered) expect(within(box).getByText(name)).toBeTruthy();
    for (const name of notOffered) expect(within(box).queryByRole("button", { name })).toBeNull();
  });

  it("follows what the request is when it was read, not what the list said: a request that was accepted meanwhile cannot be accepted again", async () => {
    new FakeServer([named("r1", "Ann", "Kowalska")]);
    api.fetchRegistration.mockResolvedValue(detail("r1", { status: "accepted", attendee_id: "at-1" }));
    renderTab({ search: EVERY_STATE });
    await loaded();

    const box = await openRequest("r1", "Ann Kowalska");

    await waitFor(() => expect(within(box).queryByRole("button", { name: "Accept" })).toBeNull());
    expect(within(box).getByRole("link", { name: "Open attendee" }).getAttribute("href")).toBe("/admin/events/evt-1/attendees/at-1");
  });

  it("confirms the request as it was read, not as the list said: a guest who confirmed the address meanwhile is accepted, with the seat of the person they bring", async () => {
    new FakeServer([named("r1", "Ann", "Kowalska", { status: "awaiting_email" })]);
    api.fetchRegistration.mockResolvedValue(detail("r1", { status: "pending", companions: [{ name: "Cy Park", custom_data: null }] }));
    api.acceptRegistrations.mockResolvedValue({ results: [{ id: "r1", outcome: "accepted", attendee_id: "at-1" }] });
    renderTab({ search: EVERY_STATE });
    await loaded();
    const box = await openRequest("r1", "Ann Kowalska");
    await within(box).findByText("Request");

    press(box, "Accept");

    const confirm = await screen.findByRole("dialog", { name: "Accept this request?" });
    expect(confirm.textContent).toContain("They take 2 seats, counting the people they bring.");
    press(confirm, "Accept");
    expect(await screen.findByText("1 request accepted.")).toBeTruthy();
    expect(api.acceptRegistrations).toHaveBeenCalledWith("evt-1", ["r1"]);
  });

  it("warns that deleting erases the attendee when the request was accepted meanwhile, though the list still shows it waiting", async () => {
    new FakeServer([named("r1", "Ann", "Kowalska", { status: "pending" })]);
    api.fetchRegistration.mockResolvedValue(detail("r1", { status: "accepted", attendee_id: "at-1" }));
    renderTab({ search: EVERY_STATE });
    await loaded();
    const box = await openRequest("r1", "Ann Kowalska");
    await within(box).findByText("Request");

    press(box, "Delete");

    const confirm = await screen.findByRole("dialog", { name: "Delete this request?" });
    expect(confirm.textContent).toContain("This request is accepted, so the guest is an attendee. Deleting it also erases the attendee.");
  });

  it("accepts from the window: the confirmation opens over it, and when it is done both are gone, the keyboard is on the next request and a toast says what happened", async () => {
    renderTab({ search: QUEUE });
    await loaded();
    const box = await openRequest("r1", "Ann Kowalska");
    await within(box).findByText("Request");

    press(box, "Accept");

    const confirm = await screen.findByRole("dialog", { name: "Accept this request?" });
    expect(screen.getAllByRole("dialog")).toHaveLength(2);
    expect(api.acceptRegistrations).not.toHaveBeenCalled();
    const go = within(confirm).getByRole("button", { name: "Accept" });
    go.focus();
    fireEvent.click(go);

    expect(await screen.findByText("1 request accepted.")).toBeTruthy();
    expect(api.acceptRegistrations).toHaveBeenCalledWith("evt-1", ["r1"]);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(openIds()).toEqual(["r2", "r3"]));
    await waitFor(() => expect(document.activeElement).toBe(openButton("r2")));
  });

  it("rejects from the window, with the message to the guest off until it is turned on", async () => {
    renderTab({ search: QUEUE });
    await loaded();
    const box = await openRequest("r2", "Bo Lee");
    await within(box).findByText("Request");

    press(box, "Reject");

    const confirm = await screen.findByRole("dialog", { name: "Reject this request?" });
    const message = within(confirm).getByRole("checkbox", { name: "Send a message to the guest" }) as HTMLInputElement;
    expect(message.checked).toBe(false);
    fireEvent.click(message);
    press(confirm, "Reject");

    expect(await screen.findByText("1 request rejected. The guests are emailed.")).toBeTruthy();
    expect(api.rejectRegistrations).toHaveBeenCalledWith("evt-1", ["r2"], true);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("deletes from the window, and says that an accepted request erases its attendee too", async () => {
    new FakeServer([named("r1", "Ann", "Kowalska", { status: "accepted" }), named("r2", "Bo", "Lee")]);
    api.fetchRegistration.mockResolvedValue(detail("r1", { status: "accepted", attendee_id: "at-1" }));
    renderTab({ search: EVERY_STATE });
    await loaded();
    const box = await openRequest("r1", "Ann Kowalska");
    await within(box).findByText("Request");

    press(box, "Delete");

    const confirm = await screen.findByRole("dialog", { name: "Delete this request?" });
    expect(confirm.textContent).toContain("This request is accepted, so the guest is an attendee. Deleting it also erases the attendee.");
    press(confirm, "Delete");
    expect(await screen.findByText("1 request deleted. 1 attendee erased too.")).toBeTruthy();
    expect(api.deleteRegistrations).toHaveBeenCalledWith("evt-1", ["r1"]);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(openIds()).toEqual(["r2"]));
  });

  it("keeps the window when the confirmation is cancelled, with the keyboard inside it", async () => {
    renderTab({ search: QUEUE });
    await loaded();
    const box = await openRequest("r1", "Ann Kowalska");
    await within(box).findByText("Request");
    press(box, "Accept");
    const confirm = await screen.findByRole("dialog", { name: "Accept this request?" });

    press(confirm, "Cancel");

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Accept this request?" })).toBeNull());
    expect(screen.getByRole("dialog", { name: "Ann Kowalska" })).toBeTruthy();
    await waitFor(() => expect(box.contains(document.activeElement)).toBe(true));
    expect(api.acceptRegistrations).not.toHaveBeenCalled();
  });

  it("lets Escape close the confirmation and leave the window open, and the next Escape close the window", async () => {
    renderTab({ search: QUEUE });
    await loaded();
    const box = await openRequest("r1", "Ann Kowalska");
    await within(box).findByText("Request");
    press(box, "Accept");
    await screen.findByRole("dialog", { name: "Accept this request?" });

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Accept this request?" })).toBeNull());
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog", { name: "Ann Kowalska" })).toBeTruthy();

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("drops only the request that was acted on from the selection: the ticks of the others stay", async () => {
    renderTab({ search: QUEUE });
    await loaded();
    fireEvent.click(checkbox("Cy Park"));
    const box = await openRequest("r1", "Ann Kowalska");
    await within(box).findByText("Request");
    press(box, "Accept");
    press(await screen.findByRole("dialog", { name: "Accept this request?" }), "Accept");

    await screen.findByText("1 request accepted.");

    await waitFor(() => expect(openIds()).toEqual(["r2", "r3"]));
    expect((checkbox("Cy Park") as HTMLInputElement).checked).toBe(true);
    expect(requestsPanel().querySelector(".attendees-bulkbar")?.textContent).toContain("1 selected");
  });

  it("is off on an archived event for the decisions, with the reason, and not for Delete", async () => {
    new FakeServer([named("r1", "Ann", "Kowalska", { last_mail: FAILED_MAIL })]);
    api.fetchRegistration.mockResolvedValue(detail("r1", { mails: [mailRow("m1", { status: "failed", retryable: false, can_retry: true })] }));
    renderTab({ search: EVERY_STATE, event: ARCHIVED });
    await loaded();

    const box = await openRequest("r1", "Ann Kowalska");
    const again = await within(box).findByRole("button", { name: "Send again" });

    for (const name of ["Accept", "Reject"]) {
      expect(isOff(within(box).getByRole("button", { name }))).toBe(true);
      expect(getTooltipText(within(box).getByRole("button", { name }))).toBe("This event is archived. Editing is disabled.");
    }
    expect(isOff(again)).toBe(true);
    expect(isOff(within(box).getByRole("button", { name: "Delete" }))).toBe(false);
  });
});

describe("a request that cannot be read", () => {
  it("says so in the words of the app, with a Retry that stays on screen, busy, until the answer is in, and the decisions are still there", async () => {
    api.fetchRegistration.mockRejectedValueOnce(new ApiError(500, "boom", "internal_error"));
    renderTab({ search: EVERY_STATE });
    await loaded();

    const box = await openRequest("r1", "Ann Kowalska");

    const alert = await within(box).findByRole("alert");
    expect(alert.textContent).toContain("Something went wrong. Try again. If it keeps happening, check System logs.");
    expect(within(box).getByRole("button", { name: "Accept" })).toBeTruthy();
    const record = deferred<RegistrationDetailDto>();
    api.fetchRegistration.mockReturnValueOnce(record.promise);
    const retry = within(box).getByRole("button", { name: "Retry" });
    retry.focus();
    fireEvent.click(retry);

    await waitFor(() => expect(retry.getAttribute("aria-busy")).toBe("true"));
    expect(within(box).getByRole("alert")).toBeTruthy();
    await act(async () => record.resolve(detail("r1")));
    expect(await within(box).findByText("Request", { selector: "h3" })).toBeTruthy();
    expect(within(box).queryByRole("alert")).toBeNull();
  });

  it("says that a request that is gone is not found", async () => {
    api.fetchRegistration.mockRejectedValue(new ApiError(404, "not_found", "not_found"));
    renderTab({ search: EVERY_STATE });
    await loaded();

    const box = await openRequest("r1", "Ann Kowalska");

    expect((await within(box).findByRole("alert")).textContent).toContain("The requested item was not found.");
  });
});

describe("closing the window", () => {
  it.each([
    ["the Close button", (box: HTMLElement) => fireEvent.click(within(box).getByRole("button", { name: "Close" }))],
    ["Escape", () => fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" })],
    ["a click outside", (box: HTMLElement) => fireEvent.click(box.closest("dialog")?.querySelector(".at-modal-backdrop") as HTMLElement)],
  ])("with %s brings the keyboard back to the request that was opened", async (_way, close) => {
    renderTab({ search: EVERY_STATE });
    await loaded();
    const opener = openButton("r2") as HTMLElement;
    opener.focus();
    const box = await openRequest("r2", "Bo Lee");
    await within(box).findByText("Request");

    close(box);

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
    expect(api.acceptRegistrations).not.toHaveBeenCalled();
  });

  it("reads each request when it is opened: another one is a window of its own", async () => {
    api.fetchRegistration.mockImplementation(async (_event: string, id: string) => detail(id, { first_name: id === "r1" ? "Ann" : "Bo" }));
    renderTab({ search: EVERY_STATE });
    await loaded();

    let box = await openRequest("r1", "Ann Kowalska");
    await within(box).findByText("Request");
    fireEvent.click(within(box).getByRole("button", { name: "Close" }));
    box = await openRequest("r3", "Cy Park");
    await within(box).findByText("Request");

    expect(api.fetchRegistration.mock.calls.map((call) => call[1])).toEqual(["r1", "r3"]);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });
});
