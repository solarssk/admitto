// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/api/client.js";
import { CODE_MESSAGES } from "../../src/api/operator-api-error.js";
import type { EventCustomFieldDto, SensitiveRevealDto } from "../../src/api/types.js";
import { AttendeeSensitiveAnswers, REVEAL_CONFIRM_TEXT, RequestSensitiveAnswers } from "../../src/attendees/SensitiveAnswers.js";
import { REVEAL_VISIBLE_MS } from "../../src/attendees/useSensitiveReveal.js";
import { advanceTimers, deferred } from "../test-utils.js";

const api = { attendee: vi.fn(), request: vi.fn() };
vi.mock("../../src/api/client.js", async () => ({
  ...(await vi.importActual<typeof import("../../src/api/client.js")>("../../src/api/client.js")),
  revealAttendeeSensitive: (...args: unknown[]) => api.attendee(...args),
  revealRegistrationSensitive: (...args: unknown[]) => api.request(...args),
}));

const SECRET = "needs a ramp at the side door";
const OTHER_SECRET = "no peanuts, severe allergy";

function field(source_field: string, label: string, extra: Partial<EventCustomFieldDto> = {}): EventCustomFieldDto {
  return {
    id: `f-${source_field}`,
    source_field,
    label,
    description: null,
    type: "text",
    required: false,
    show_on_form: true,
    display_order: 0,
    options: null,
    rules: null,
    created_at: "2026-10-01T00:00:00.000Z",
    ...extra,
  };
}

const ACCESS = field("access", "Accessibility needs", { sensitive: true });
const DIET = field("diet", "Allergies", { sensitive: true });
const SHIRT = field("shirt", "Shirt size");
const QUESTIONS = [SHIRT, ACCESS, DIET];

const answer = (guest: Record<string, string>, companions: SensitiveRevealDto["companions"] = []): SensitiveRevealDto => ({ guest, companions });

function renderGuest(props: { canReveal?: boolean; slot?: number | null; id?: string } = {}) {
  const { canReveal = true, slot = null, id = "att-1" } = props;
  return render(
    <AttendeeSensitiveAnswers key={id} eventId="evt-1" attendeeId={id} questions={QUESTIONS} slot={slot} who="guest" canReveal={canReveal} timezone="UTC" />,
  );
}

const showButton = () => screen.getByRole("button", { name: "Show sensitive answers of guest" });
async function reveal() {
  fireEvent.click(showButton());
  fireEvent.click(within(screen.getByRole("group", { name: "Show sensitive answers of guest?" })).getByRole("button", { name: "Show" }));
  await act(async () => {});
}
const rowOf = (label: string) => screen.getByText(label, { selector: "dt" }).parentElement as HTMLElement;
const pageText = () => document.body.textContent ?? "";

beforeEach(() => {
  api.attendee.mockReset();
  api.request.mockReset();
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the masks", { timeout: 30_000 }, () => {
  it("shows each sensitive question as hidden, never an ordinary question, and no value", () => {
    renderGuest();

    expect(within(rowOf("Accessibility needs")).getByText("Hidden")).toBeTruthy();
    expect(within(rowOf("Allergies")).getByText("Hidden")).toBeTruthy();
    expect(screen.queryByText("Shirt size")).toBeNull();
    expect(api.attendee).not.toHaveBeenCalled();
  });

  it("draws nothing for a person who is asked no sensitive question", () => {
    const { container } = render(
      <AttendeeSensitiveAnswers eventId="evt-1" attendeeId="a" questions={[SHIRT]} slot={null} canReveal timezone="UTC" />,
    );

    expect(container.textContent).toBe("");
  });

  it("offers an operator the masks and no button", () => {
    renderGuest({ canReveal: false });

    expect(within(rowOf("Allergies")).getByText("Hidden")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("Show", { timeout: 30_000 }, () => {
  it("asks first, in words that say what is recorded, and Cancel calls nothing and gives the focus back", () => {
    renderGuest();

    fireEvent.click(showButton());

    const box = screen.getByRole("group", { name: "Show sensitive answers of guest?" });
    expect(box.textContent).toContain(REVEAL_CONFIRM_TEXT);
    expect(REVEAL_CONFIRM_TEXT).toBe("Showing sensitive answers is recorded in the audit log: who, when and which questions, never the answers.");
    expect(document.activeElement).toBe(within(box).getByRole("button", { name: "Show" }));
    fireEvent.click(within(box).getByRole("button", { name: "Cancel" }));
    expect(api.attendee).not.toHaveBeenCalled();
    expect(screen.queryByRole("group")).toBeNull();
    expect(document.activeElement).toBe(showButton());
    expect(within(rowOf("Allergies")).getByText("Hidden")).toBeTruthy();
  });

  it("shows the answers of the person when it is confirmed, and 'No answer' for a question without one", async () => {
    api.attendee.mockResolvedValue(answer({ access: SECRET }));
    renderGuest();

    await reveal();

    expect(api.attendee).toHaveBeenCalledTimes(1);
    expect(api.attendee).toHaveBeenCalledWith("evt-1", "att-1");
    expect(within(rowOf("Accessibility needs")).getByText(SECRET)).toBeTruthy();
    expect(within(rowOf("Allergies")).getByText("No answer")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Hide sensitive answers of guest" })).toBeTruthy();
  });

  it("never shows an answer to an ordinary question, whatever the answer carries", async () => {
    api.attendee.mockResolvedValue(answer({ shirt: "XXL", access: SECRET }));
    renderGuest();

    await reveal();

    expect(pageText()).not.toContain("XXL");
  });

  it("shows the answers of the companion at its slot, and the guest's own are not in that box", async () => {
    api.attendee.mockResolvedValue(answer({ access: SECRET }, [{ slot: 1, answers: { diet: OTHER_SECRET } }]));
    render(<AttendeeSensitiveAnswers eventId="evt-1" attendeeId="a" questions={QUESTIONS} slot={1} who="guest" canReveal timezone="UTC" />);

    await reveal();

    expect(within(rowOf("Allergies")).getByText(OTHER_SECRET)).toBeTruthy();
    expect(within(rowOf("Accessibility needs")).getByText("No answer")).toBeTruthy();
    expect(pageText()).not.toContain(SECRET);
  });

  it("says 'No answer' for every question of a companion that the answer leaves out", async () => {
    api.attendee.mockResolvedValue(answer({ access: SECRET }));
    render(<AttendeeSensitiveAnswers eventId="evt-1" attendeeId="a" questions={QUESTIONS} slot={1} who="guest" canReveal timezone="UTC" />);

    await reveal();

    expect(screen.getAllByText("No answer")).toHaveLength(2);
  });

  it("reads the answers of a request from the request's own call", async () => {
    api.request.mockResolvedValue(answer({}, [{ slot: 2, answers: { access: SECRET } }]));
    render(<RequestSensitiveAnswers eventId="evt-1" requestId="req-1" questions={QUESTIONS} slot={2} who="guest" canReveal timezone="UTC" />);

    await reveal();

    expect(api.request).toHaveBeenCalledWith("evt-1", "req-1");
    expect(api.attendee).not.toHaveBeenCalled();
    expect(within(rowOf("Accessibility needs")).getByText(SECRET)).toBeTruthy();
  });

  it("keeps the button busy while the request is on its way, and a second click does not send a second", async () => {
    const held = deferred<SensitiveRevealDto>();
    api.attendee.mockReturnValue(held.promise);
    renderGuest();

    fireEvent.click(showButton());
    fireEvent.click(within(screen.getByRole("group")).getByRole("button", { name: "Show" }));
    await act(async () => {});

    const busy = showButton();
    expect(busy.getAttribute("aria-busy")).toBe("true");
    fireEvent.click(busy);
    expect(api.attendee).toHaveBeenCalledTimes(1);
    await act(async () => held.resolve(answer({ access: SECRET })));
    expect(screen.getByText(SECRET)).toBeTruthy();
  });
});

describe("a refusal", { timeout: 30_000 }, () => {
  it.each([
    ["403 forbidden", new ApiError(403, "forbidden", "forbidden"), CODE_MESSAGES.forbidden],
    ["409 attendee_erased", new ApiError(409, "attendee_erased", "attendee_erased"), CODE_MESSAGES.attendee_erased],
    ["404 not_found", new ApiError(404, "not_found", "not_found"), CODE_MESSAGES.not_found],
    ["429 sensitive_reveal_limit", new ApiError(429, "sensitive_reveal_limit", "sensitive_reveal_limit"), CODE_MESSAGES.sensitive_reveal_limit],
    ["500 with a text that carries a value", new ApiError(500, `could not write the audit entry for ${SECRET}`), "Could not show the answers."],
  ])("%s is said in a sentence, with no value in it, and the masks stay", async (_name, error, text) => {
    api.attendee.mockRejectedValue(error);
    renderGuest();

    await reveal();

    expect(screen.getByRole("alert").textContent).toBe(text);
    expect(pageText()).not.toContain(SECRET);
    expect(within(rowOf("Allergies")).getByText("Hidden")).toBeTruthy();
    expect(showButton()).toBeTruthy();
  });
});

describe("hiding again", { timeout: 30_000 }, () => {
  it("Hide takes the answers off the screen and says so to assistive technology", async () => {
    api.attendee.mockResolvedValue(answer({ access: SECRET }));
    renderGuest();
    await reveal();

    fireEvent.click(screen.getByRole("button", { name: "Hide sensitive answers of guest" }));

    expect(pageText()).not.toContain(SECRET);
    expect(within(rowOf("Accessibility needs")).getByText("Hidden")).toBeTruthy();
    const live = document.querySelector("[aria-live='polite']");
    expect(live?.textContent).toBe("Sensitive answers hidden");
  });

  it("hides them after two minutes, and not a moment before", async () => {
    vi.useFakeTimers();
    api.attendee.mockResolvedValue(answer({ access: SECRET }));
    renderGuest();
    await reveal();

    await advanceTimers(REVEAL_VISIBLE_MS - 1000);
    expect(screen.getByText(SECRET)).toBeTruthy();
    expect(REVEAL_VISIBLE_MS).toBe(120_000);
    await advanceTimers(1000);

    expect(pageText()).not.toContain(SECRET);
    expect(document.querySelector("[aria-live='polite']")?.textContent).toBe("Sensitive answers hidden");
  });

  it("starts the two minutes again for a second Show", async () => {
    vi.useFakeTimers();
    api.attendee.mockResolvedValue(answer({ access: SECRET }));
    renderGuest();
    await reveal();
    await advanceTimers(REVEAL_VISIBLE_MS);

    await reveal();
    await advanceTimers(REVEAL_VISIBLE_MS - 1000);

    expect(screen.getByText(SECRET)).toBeTruthy();
    expect(api.attendee).toHaveBeenCalledTimes(2);
  });

  it("drops the answers when the person changes, and an answer that comes late for the old one is not shown", async () => {
    const held = deferred<SensitiveRevealDto>();
    api.attendee.mockReturnValueOnce(held.promise);
    const view = renderGuest({ id: "att-1" });
    fireEvent.click(showButton());
    fireEvent.click(within(screen.getByRole("group")).getByRole("button", { name: "Show" }));

    view.rerender(
      <AttendeeSensitiveAnswers key="att-2" eventId="evt-1" attendeeId="att-2" questions={QUESTIONS} slot={null} who="guest" canReveal timezone="UTC" />,
    );
    await act(async () => held.resolve(answer({ access: SECRET })));

    expect(pageText()).not.toContain(SECRET);
    expect(within(rowOf("Accessibility needs")).getByText("Hidden")).toBeTruthy();
  });

  it("drops the answers when the person changes after they were shown", async () => {
    api.attendee.mockResolvedValue(answer({ access: SECRET }));
    const view = renderGuest({ id: "att-1" });
    await reveal();

    view.rerender(
      <AttendeeSensitiveAnswers key="att-2" eventId="evt-1" attendeeId="att-2" questions={QUESTIONS} slot={null} who="guest" canReveal timezone="UTC" />,
    );

    expect(pageText()).not.toContain(SECRET);
  });

  it("drops the answers when the window or the page goes, and an answer that comes after is dropped", async () => {
    const held = deferred<SensitiveRevealDto>();
    api.attendee.mockReturnValueOnce(held.promise);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const view = renderGuest();
    fireEvent.click(showButton());
    fireEvent.click(within(screen.getByRole("group")).getByRole("button", { name: "Show" }));

    view.unmount();
    await act(async () => held.resolve(answer({ access: SECRET })));

    expect(document.body.textContent).not.toContain(SECRET);
    expect(errors).not.toHaveBeenCalled();
  });
});

describe("where the answers are kept", { timeout: 30_000 }, () => {
  it("not in local or session storage, not in the address, not in the console", async () => {
    const logs = [vi.spyOn(console, "log"), vi.spyOn(console, "info"), vi.spyOn(console, "warn"), vi.spyOn(console, "error"), vi.spyOn(console, "debug")];
    for (const spy of logs) spy.mockImplementation(() => {});
    api.attendee.mockResolvedValue(answer({ access: SECRET, diet: OTHER_SECRET }));
    renderGuest();

    await reveal();

    expect(screen.getByText(SECRET)).toBeTruthy();
    expect(JSON.stringify({ ...localStorage })).not.toContain(SECRET);
    expect(JSON.stringify({ ...sessionStorage })).not.toContain(OTHER_SECRET);
    expect(localStorage).toHaveLength(0);
    expect(sessionStorage).toHaveLength(0);
    expect(window.location.href).not.toContain(SECRET);
    for (const spy of logs) expect(spy).not.toHaveBeenCalled();
  });
});
