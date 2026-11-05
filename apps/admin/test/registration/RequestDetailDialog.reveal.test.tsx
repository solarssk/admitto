// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/api/client.js";
import { CODE_MESSAGES } from "../../src/api/operator-api-error.js";
import type { EventCustomFieldDto, RoleAssignment } from "../../src/api/types.js";
import { makeOrgAdminAssignment, mockMatchMedia } from "../test-utils.js";
import { FakeServer, api, resetApi } from "./requestsApi.js";
import { EVENT, detail, named, openButton, renderTab } from "./requestsFixtures.js";

/** "Show" in the window of a request (D-E6): the masks of the guest's and the companion's sensitive questions, the button for each. */
const reveal = vi.hoisted(() => ({ request: vi.fn() }));
let assignments: RoleAssignment[] = [];

vi.mock("../../src/api/client.js", async () => ({
  ...(await (await import("./requestsApi.js")).mockedClient()),
  revealRegistrationSensitive: (...args: unknown[]) => reveal.request(...args),
}));
vi.mock("../../src/connection/ConnectionStateProvider.js");
vi.mock("../../src/auth/login-navigation.js", async () => (await import("./requestsApi.js")).loginNavigationModule());
vi.mock("../../src/registration/RegistrationFieldsTab.js", async () => (await import("./requestsApi.js")).fieldsTabModule());
vi.mock("../../src/registration/RegistrationLegalTab.js", async () => (await import("./requestsApi.js")).legalTabModule());
vi.mock("../../src/auth/AuthProvider.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/auth/AuthProvider.js")>()),
  useOptionalAuth: () => ({ assignments }),
}));

const SECRET = "uses a wheelchair";
const COMPANION_SECRET = "peanut allergy";

const field = (source_field: string, label: string, extra: Partial<EventCustomFieldDto> = {}): EventCustomFieldDto => ({
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
});
const FIELDS = [
  field("shirt", "Shirt size"),
  field("access", "Accessibility needs", { sensitive: true }),
  field("allergy", "Allergies", { applies_to: "companion", sensitive: true }),
];

async function openWindow({ waitForAnswers = true } = {}) {
  renderTab({ search: "?tab=requests&status=all", event: { ...EVENT, organization_id: "org-1" } });
  await screen.findByRole("table", { name: "Requests" });
  fireEvent.click(openButton("r1") as HTMLElement);
  const box = await screen.findByRole("dialog", { name: "Ann Kowalska" });
  // The window opens before the request is read and draws its sections when the read comes back, which a slow runner may do later.
  if (waitForAnswers) await within(box).findByRole("heading", { name: "Answers" });
  return box;
}
const sectionOf = (box: HTMLElement, title: string) => within(box).getByRole("heading", { name: title }).parentElement as HTMLElement;
async function show(section: HTMLElement, who: string) {
  fireEvent.click(within(section).getByRole("button", { name: `Show sensitive answers of ${who}` }));
  fireEvent.click(within(within(section).getByRole("group")).getByRole("button", { name: "Show" }));
  await act(async () => {});
}

beforeEach(() => {
  mockMatchMedia(true);
  resetApi();
  new FakeServer([named("r1", "Ann", "Kowalska")]);
  assignments = [makeOrgAdminAssignment()];
  api.fetchEventCustomFields.mockResolvedValue(FIELDS);
  api.fetchRegistration.mockResolvedValue(
    detail("r1", { custom_data: { shirt: "M" }, companions: [{ name: "Piotr", custom_data: { allergy: null } }] }),
  );
  reveal.request.mockReset();
  reveal.request.mockResolvedValue({ guest: { access: SECRET }, companions: [{ slot: 1, answers: { allergy: COMPANION_SECRET } }] });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("a request's sensitive answers", { timeout: 30_000 }, () => {
  it("shows an ordinary answer, and the sensitive questions as hidden, in the Answers and the Companion sections", async () => {
    const box = await openWindow();

    const answers = sectionOf(box, "Answers");
    expect(within(answers).getByText("M")).toBeTruthy();
    expect(within(answers).getByText("Accessibility needs").parentElement?.textContent).toContain("Hidden");
    const companion = sectionOf(box, "Companion");
    expect(within(companion).getByText("Allergies").parentElement?.textContent).toContain("Hidden");
    expect(reveal.request).not.toHaveBeenCalled();
  });

  it("draws the Answers section for the sensitive questions alone when the guest gave no ordinary answer", async () => {
    api.fetchRegistration.mockResolvedValue(detail("r1", { custom_data: {}, companions: [] }));

    const box = await openWindow();

    const answers = sectionOf(box, "Answers");
    expect(within(answers).getByText("Accessibility needs").parentElement?.textContent).toContain("Hidden");
    expect(within(answers).queryByText("Shirt size")).toBeNull();
  });

  it("draws no Answers section when there is no answer and no sensitive question for the guest", async () => {
    api.fetchEventCustomFields.mockResolvedValue([field("shirt", "Shirt size")]);
    api.fetchRegistration.mockResolvedValue(detail("r1", { custom_data: {}, companions: [] }));

    const box = await openWindow({ waitForAnswers: false });
    await waitFor(() => expect(api.fetchRegistration).toHaveBeenCalled());
    await act(async () => {});

    expect(within(box).queryByRole("heading", { name: "Answers" })).toBeNull();
  });

  it("shows each person's answers from their own button, one call and one audit entry for each", async () => {
    const box = await openWindow();

    await show(sectionOf(box, "Answers"), "guest");
    expect(within(sectionOf(box, "Answers")).getByText(SECRET)).toBeTruthy();
    expect(reveal.request).toHaveBeenCalledWith("evt-1", "r1");
    expect(within(sectionOf(box, "Companion")).queryByText(COMPANION_SECRET)).toBeNull();

    await show(sectionOf(box, "Companion"), "companion 1");
    expect(within(sectionOf(box, "Companion")).getByText(COMPANION_SECRET)).toBeTruthy();
    expect(reveal.request).toHaveBeenCalledTimes(2);
  });

  it("offers an operator no button, and an administrator of another organization none", async () => {
    assignments = [{ role: "operator", scope_type: "event", scope_id: "evt-1" } as RoleAssignment];
    const box = await openWindow();
    expect(within(box).queryByRole("button", { name: /Show sensitive answers/ })).toBeNull();
    expect(within(sectionOf(box, "Answers")).getByText("Accessibility needs").parentElement?.textContent).toContain("Hidden");
    cleanup();

    assignments = [makeOrgAdminAssignment({ scope_id: "org-other" })];
    const other = await openWindow();
    expect(within(other).queryByRole("button", { name: /Show sensitive answers/ })).toBeNull();
  });

  it("says a refused Show in the window, with no value, and keeps the mask", async () => {
    reveal.request.mockRejectedValue(new ApiError(404, "not_found", "not_found"));
    const box = await openWindow();

    await show(sectionOf(box, "Answers"), "guest");

    expect(within(box).getByRole("alert").textContent).toBe(CODE_MESSAGES.not_found);
    expect(within(sectionOf(box, "Answers")).getByText("Accessibility needs").parentElement?.textContent).toContain("Hidden");
  });

  it("drops the answers when the window is closed, and shows the mask again when it is opened again", async () => {
    const box = await openWindow();
    await show(sectionOf(box, "Answers"), "guest");

    fireEvent.click(within(box).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.body.textContent).not.toContain(SECRET);
    fireEvent.click(openButton("r1") as HTMLElement);
    const again = await screen.findByRole("dialog", { name: "Ann Kowalska" });
    await within(again).findByRole("heading", { name: "Answers" });

    expect(within(sectionOf(again, "Answers")).getByText("Accessibility needs").parentElement?.textContent).toContain("Hidden");
  });

  it("draws no block for a request of an event that has no sensitive question", async () => {
    api.fetchEventCustomFields.mockResolvedValue([FIELDS[0]]);
    const box = await openWindow();

    expect(within(box).queryByText("Sensitive answers")).toBeNull();
  });
});
