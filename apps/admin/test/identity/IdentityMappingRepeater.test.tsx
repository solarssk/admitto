// @vitest-environment jsdom
vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    fetchAdminEvents: vi.fn(),
    fetchAdminOrganizations: vi.fn(),
  };
});

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchAdminEvents, fetchAdminOrganizations } from "../../src/api/client.js";
import type { EventDto } from "../../src/api/types.js";
import { IdentityMappingRepeater } from "../../src/identity/IdentityMappingRepeater.js";
import type { MappingRow, MappingRowError } from "../../src/identity/identityProviderValidation.js";
import { advanceTimers, deferred, hangUntilAborted } from "../test-utils.js";

const mockFetchEvents = vi.mocked(fetchAdminEvents);
const mockFetchOrganizations = vi.mocked(fetchAdminOrganizations);

const FIXTURE_EVENT: EventDto = {
  id: "evt-1",
  title: "Spring Summit",
  slug: "spring-summit",
  date: "2026-09-15T12:00:00.000Z",
  timezone: "Europe/Warsaw",
  event_hours_start: null,
  event_hours_end: null,
  location: "Warsaw",
  organization_id: "org-1",
  archived_at: null,
};

beforeEach(() => {
  mockFetchEvents.mockResolvedValue([FIXTURE_EVENT]);
  mockFetchOrganizations.mockResolvedValue([{ id: "org-1", name: "Acme Events" }]);
});

afterEach(cleanup);

function row(overrides: Partial<MappingRow> = {}): MappingRow {
  return { id: "row-1", group: "admins", role: "operator", scope_type: "instance", scope_id: "", ...overrides };
}

describe("IdentityMappingRepeater invalid-picker association (bot review finding, #759)", () => {
  it("points the Role picker's aria-describedby at its error text when the row has a role error", () => {
    const errors: MappingRowError[] = [{ role: "Pick a role." }];
    render(
      <IdentityMappingRepeater rows={[row({ role: "legacy-role" as MappingRow["role"] })]} errors={errors} onChange={vi.fn()} />,
    );

    const trigger = screen.getByRole("button", { name: /^Role,/ });
    // Not aria-invalid: this trigger is a <button> (role "button"), and aria-invalid isn't a
    // supported property of that role (SonarCloud S6811) - the error is associated via
    // aria-describedby instead, same as a plain aria-invalid attribute would be inspected.
    expect(trigger.getAttribute("aria-invalid")).toBeNull();
    const describedById = trigger.getAttribute("aria-describedby");
    expect(describedById).toBeTruthy();
    expect(document.getElementById(describedById!)?.textContent).toBe("Pick a role.");
  });

  it("points the Scope picker's aria-describedby at its error text when the row has a scope error", () => {
    const errors: MappingRowError[] = [{ scope_type: "Pick a scope." }];
    render(
      <IdentityMappingRepeater rows={[row({ scope_type: "legacy-scope" as MappingRow["scope_type"] })]} errors={errors} onChange={vi.fn()} />,
    );

    const trigger = screen.getByRole("button", { name: /^Scope,/ });
    const describedById = trigger.getAttribute("aria-describedby");
    expect(describedById).toBeTruthy();
    expect(document.getElementById(describedById!)?.textContent).toBe("Pick a scope.");
  });

  it("leaves aria-describedby unset on either picker when the row is valid", () => {
    render(<IdentityMappingRepeater rows={[row()]} errors={[{}]} onChange={vi.fn()} />);

    expect(screen.getByRole("button", { name: /^Role,/ }).getAttribute("aria-describedby")).toBeNull();
    expect(screen.getByRole("button", { name: /^Scope,/ }).getAttribute("aria-describedby")).toBeNull();
  });
});

describe("IdentityMappingRepeater scope_id picker", () => {
  it("offers real events, fetched from the API, instead of a free-text field", async () => {
    const onChange = vi.fn();
    render(
      <IdentityMappingRepeater
        rows={[row({ role: "operator", scope_type: "event", scope_id: "" })]}
        errors={[{}]}
        onChange={onChange}
      />,
    );

    // No free-text UUID field left to type into - it's a picker, same trigger/panel shape as Role.
    expect(screen.queryByLabelText("Event ID")).toBeNull();
    const trigger = await screen.findByRole("button", { name: /^Event,/ });
    fireEvent.click(trigger);
    const option = await screen.findByRole("button", { name: "Spring Summit" });
    fireEvent.click(option);

    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ scope_id: "evt-1" })]);
  });

  it("offers real organizations for an organization-scoped row", async () => {
    const onChange = vi.fn();
    render(
      <IdentityMappingRepeater
        rows={[row({ role: "admin", scope_type: "organization", scope_id: "" })]}
        errors={[{}]}
        onChange={onChange}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: /^Organization,/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Acme Events" }));

    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ scope_id: "org-1" })]);
  });

  it("still shows a saved scope_id that no longer matches any fetched event, instead of looking empty", async () => {
    render(
      <IdentityMappingRepeater
        rows={[row({ role: "operator", scope_type: "event", scope_id: "evt-deleted" })]}
        errors={[{}]}
        onChange={vi.fn()}
      />,
    );

    // Same fallback pattern as the Role picker's "(invalid, pick a role)" entry - a mismatched
    // stored value must stay visible, not silently read as "none selected" (nothing was cleared).
    expect(await screen.findByRole("button", { name: /^Event, evt-deleted \(not found\)/ })).toBeTruthy();
  });

  it("shows the real name for a saved scope_id that does match a fetched event", async () => {
    render(
      <IdentityMappingRepeater
        rows={[row({ role: "operator", scope_type: "event", scope_id: "evt-1" })]}
        errors={[{}]}
        onChange={vi.fn()}
      />,
    );

    // A known, still-valid stored id resolves to its real name, not the "(not found)" fallback -
    // the other branch of the same currentKnown check exercised above.
    expect(await screen.findByRole("button", { name: "Event, Spring Summit" })).toBeTruthy();
  });

  it("points the scope_id picker's aria-describedby at its error text", async () => {
    const errors: MappingRowError[] = [{ scope_id: "Scope ID is required for this scope." }];
    render(
      <IdentityMappingRepeater
        rows={[row({ role: "operator", scope_type: "event", scope_id: "" })]}
        errors={errors}
        onChange={vi.fn()}
      />,
    );

    const trigger = await screen.findByRole("button", { name: /^Event,/ });
    const describedById = trigger.getAttribute("aria-describedby");
    expect(describedById).toBeTruthy();
    expect(document.getElementById(describedById!)?.textContent).toBe(
      "Scope ID is required for this scope.",
    );
  });
});

describe("IdentityMappingRepeater lookups on the loading standard", () => {
  const eventRow = row({ role: "operator", scope_type: "event", scope_id: "evt-1" });

  it("holds the room of the picker invisibly for the first 200ms, shows a placeholder after, and the picker once the answer is in", async () => {
    vi.useFakeTimers();
    try {
      const events = deferred<EventDto[]>();
      mockFetchEvents.mockReturnValue(events.promise);
      render(<IdentityMappingRepeater rows={[eventRow]} errors={[{}]} onChange={vi.fn()} />);

      const placeholder = screen.getByRole("status", { name: "Loading events" });
      expect(placeholder.className).toContain("at-loading-hold");
      expect(screen.queryByRole("button", { name: /^Event,/ })).toBeNull();

      await advanceTimers(250);
      expect(screen.getByRole("status", { name: "Loading events" }).className).not.toContain("at-loading-hold");

      await act(async () => events.resolve([FIXTURE_EVENT]));
      // The placeholder that did show stays for at least 400ms, so it does not flash.
      expect(screen.getByRole("status", { name: "Loading events" })).toBeTruthy();
      await advanceTimers(400);
      expect(screen.queryByRole("status", { name: "Loading events" })).toBeNull();
      expect(screen.getByRole("button", { name: "Event, Spring Summit" })).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not show the saved scope as not found while its name is still being fetched", async () => {
    const events = deferred<EventDto[]>();
    mockFetchEvents.mockReturnValue(events.promise);
    render(<IdentityMappingRepeater rows={[row({ ...eventRow, scope_id: "evt-deleted" })]} errors={[{}]} onChange={vi.fn()} />);
    expect(screen.queryByText(/not found/)).toBeNull();

    await act(async () => events.resolve([FIXTURE_EVENT]));
    expect(await screen.findByRole("button", { name: /^Event, evt-deleted \(not found\)/ })).toBeTruthy();
  });

  it("reads only the lookups its rows need, and reads the events without the archived ones", async () => {
    render(<IdentityMappingRepeater rows={[row({ role: "operator", scope_type: "event", scope_id: "" })]} errors={[{}]} onChange={vi.fn()} />);
    await screen.findByRole("button", { name: /^Event,/ });
    expect(mockFetchEvents).toHaveBeenCalledTimes(1);
    expect(mockFetchEvents).toHaveBeenCalledWith(expect.objectContaining({ includeArchived: false }));
    expect(mockFetchOrganizations).not.toHaveBeenCalled();
  });

  it("reads nothing for rows that need no scope", async () => {
    render(<IdentityMappingRepeater rows={[row({ role: "superadmin", scope_type: "instance" })]} errors={[{}]} onChange={vi.fn()} />);
    await screen.findByDisplayValue("admins");
    expect(mockFetchEvents).not.toHaveBeenCalled();
    expect(mockFetchOrganizations).not.toHaveBeenCalled();
  });

  it("starts the lookup when a row that needs it is added", async () => {
    const { rerender } = render(<IdentityMappingRepeater rows={[row({ role: "superadmin", scope_type: "instance" })]} errors={[{}]} onChange={vi.fn()} />);
    expect(mockFetchEvents).not.toHaveBeenCalled();

    rerender(<IdentityMappingRepeater rows={[row({ role: "operator", scope_type: "event", scope_id: "" })]} errors={[{}]} onChange={vi.fn()} />);
    expect(await screen.findByRole("button", { name: /^Event,/ })).toBeTruthy();
    expect(mockFetchEvents).toHaveBeenCalledTimes(1);
  });

  it("says once that the events could not be loaded, turns the picker off, and keeps the saved scope as 'Event', not 'not found'", async () => {
    mockFetchEvents.mockRejectedValueOnce(new Error("network down"));
    render(<IdentityMappingRepeater rows={[eventRow]} errors={[{}]} onChange={vi.fn()} />);

    expect(await screen.findByText("Could not load events.")).toBeTruthy();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    const picker = screen.getByRole("button", { name: /^Event,/ });
    expect(picker.getAttribute("disabled")).not.toBeNull();
    expect(picker.textContent).not.toContain("not found");
    expect(picker.textContent).toContain("Event");
  });

  it("retries only the failed lookup: the Retry stays on screen, busy, until the answer is in, and the picker comes back", async () => {
    mockFetchEvents.mockRejectedValueOnce(new Error("network down"));
    const again = deferred<EventDto[]>();
    mockFetchEvents.mockReturnValueOnce(again.promise);
    render(
      <IdentityMappingRepeater
        rows={[eventRow, row({ id: "row-2", role: "admin", scope_type: "organization", scope_id: "org-1" })]}
        errors={[{}, {}]}
        onChange={vi.fn()}
      />,
    );
    const retry = await screen.findByRole("button", { name: "Retry loading events" });
    fireEvent.click(retry);

    const busy = screen.getByRole("button", { name: "Retry loading events" });
    expect(busy).toBe(retry);
    expect(busy.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByText("Could not load events.")).toBeTruthy();
    expect(mockFetchOrganizations).toHaveBeenCalledTimes(1);

    await act(async () => again.resolve([FIXTURE_EVENT]));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Retry loading events" })).toBeNull());
    expect(await screen.findByRole("button", { name: "Event, Spring Summit" })).toBeTruthy();
    expect(mockFetchOrganizations).toHaveBeenCalledTimes(1);
  });

  it("gives each lookup its own hint and Retry when both failed", async () => {
    mockFetchEvents.mockRejectedValue(new Error("network down"));
    mockFetchOrganizations.mockRejectedValue(new Error("network down"));
    render(
      <IdentityMappingRepeater
        rows={[eventRow, row({ id: "row-2", role: "admin", scope_type: "organization", scope_id: "org-1" })]}
        errors={[{}, {}]}
        onChange={vi.fn()}
      />,
    );
    expect(await screen.findByRole("button", { name: "Retry loading events" })).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Retry loading organizations" })).toBeTruthy();
    expect(await screen.findByText("Could not load organizations.")).toBeTruthy();
  });

  it("ends in an error with a Retry when the lookup does not answer in 30 seconds", async () => {
    vi.useFakeTimers();
    try {
      mockFetchEvents.mockImplementation(hangUntilAborted as never);
      render(<IdentityMappingRepeater rows={[eventRow]} errors={[{}]} onChange={vi.fn()} />);
      await advanceTimers(30_000);
      expect(screen.getByText(/The server did not answer in time/)).toBeTruthy();
      expect(screen.getByRole("button", { name: "Retry loading events" })).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });
});
