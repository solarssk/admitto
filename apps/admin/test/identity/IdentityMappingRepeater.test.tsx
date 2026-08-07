// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IdentityMappingRepeater } from "../../src/identity/IdentityMappingRepeater.js";
import type { MappingRow, MappingRowError } from "../../src/identity/identityProviderValidation.js";

afterEach(cleanup);

function row(overrides: Partial<MappingRow> = {}): MappingRow {
  return { id: "row-1", group: "admins", role: "operator", scope_type: "instance", scope_id: "", ...overrides };
}

describe("IdentityMappingRepeater aria-invalid (bot review finding, #759)", () => {
  it("marks the Role picker aria-invalid when its row has a role error", () => {
    const errors: MappingRowError[] = [{ role: "Pick a role." }];
    render(
      <IdentityMappingRepeater rows={[row({ role: "legacy-role" as MappingRow["role"] })]} errors={errors} onChange={vi.fn()} />,
    );

    const trigger = screen.getByRole("button", { name: /^Role,/ });
    expect(trigger.getAttribute("aria-invalid")).toBe("true");
  });

  it("marks the Scope picker aria-invalid when its row has a scope error", () => {
    const errors: MappingRowError[] = [{ scope_type: "Pick a scope." }];
    render(
      <IdentityMappingRepeater rows={[row({ scope_type: "legacy-scope" as MappingRow["scope_type"] })]} errors={errors} onChange={vi.fn()} />,
    );

    const trigger = screen.getByRole("button", { name: /^Scope,/ });
    expect(trigger.getAttribute("aria-invalid")).toBe("true");
  });

  it("does not mark either picker aria-invalid when the row is valid", () => {
    render(<IdentityMappingRepeater rows={[row()]} errors={[{}]} onChange={vi.fn()} />);

    expect(screen.getByRole("button", { name: /^Role,/ }).getAttribute("aria-invalid")).toBeNull();
    expect(screen.getByRole("button", { name: /^Scope,/ }).getAttribute("aria-invalid")).toBeNull();
  });
});
