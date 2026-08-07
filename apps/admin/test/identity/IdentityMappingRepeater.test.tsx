// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IdentityMappingRepeater } from "../../src/identity/IdentityMappingRepeater.js";
import type { MappingRow, MappingRowError } from "../../src/identity/identityProviderValidation.js";

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
