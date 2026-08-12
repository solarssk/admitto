// @vitest-environment jsdom
vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    fetchAdminEvents: vi.fn(),
    fetchAdminOrganizations: vi.fn(),
  };
});

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchAdminEvents, fetchAdminOrganizations } from "../../src/api/client.js";
import type { EventDto } from "../../src/api/types.js";
import { IdentityMappingRepeater } from "../../src/identity/IdentityMappingRepeater.js";
import type { MappingRow, MappingRowError } from "../../src/identity/identityProviderValidation.js";

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
    const trigger = screen.getByRole("button", { name: /^Event,/ });
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

    fireEvent.click(screen.getByRole("button", { name: /^Organization,/ }));
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
    await waitFor(() => mockFetchEvents.mock.calls.length > 0);
    expect(screen.getByRole("button", { name: /^Event, evt-deleted \(not found\)/ })).toBeTruthy();
  });

  it("points the scope_id picker's aria-describedby at its error text", () => {
    const errors: MappingRowError[] = [{ scope_id: "Scope ID is required for this scope." }];
    render(
      <IdentityMappingRepeater
        rows={[row({ role: "operator", scope_type: "event", scope_id: "" })]}
        errors={errors}
        onChange={vi.fn()}
      />,
    );

    const trigger = screen.getByRole("button", { name: /^Event,/ });
    const describedById = trigger.getAttribute("aria-describedby");
    expect(describedById).toBeTruthy();
    expect(document.getElementById(describedById!)?.textContent).toBe(
      "Scope ID is required for this scope.",
    );
  });
});
