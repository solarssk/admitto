// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SecurityPanel } from "../../src/settings/SecurityPanel.js";
import { renderWithToastAndRouter } from "../test-utils.js";

const baseSettings = {
  session_ttl_ms: { value: 86_400_000, source: "default" as const },
  operator_session_ttl_ms: { value: 43_200_000, source: "default" as const },
  trusted_device_days: { value: 30, source: "default" as const },
  mfa_required_roles: { value: ["superadmin"], source: "default" as const },
  instance_url: { value: null as string | null, source: "default" as const },
};

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    fetchSecuritySettings: vi.fn(),
    patchSecuritySettings: vi.fn(),
  };
});

import { fetchSecuritySettings, patchSecuritySettings } from "../../src/api/client.js";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("SecurityPanel delayed loading", () => {
  it("shows the loading placeholder once the fetch has genuinely taken a moment", () => {
    vi.mocked(fetchSecuritySettings).mockImplementationOnce(() => new Promise(() => {}));
    vi.useFakeTimers();
    renderWithToastAndRouter(<SecurityPanel />);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByText("Loading…")).toBeTruthy();
  });
});

describe("SecurityPanel — session/trust duration inputs", () => {
  it.each([
    { label: "Operator session lifetime (hours)", floor: "1" },
    { label: "Admin session lifetime (hours)", floor: "1" },
    { label: '"Remember device" duration (days, 0 = off)', floor: "0" },
  ])("clamps a non-numeric $label to the $floor floor instead of NaN", async ({ label, floor }) => {
    vi.mocked(fetchSecuritySettings).mockResolvedValue(baseSettings);
    renderWithToastAndRouter(<SecurityPanel />);

    const input = await screen.findByLabelText<HTMLInputElement>(label);
    fireEvent.change(input, { target: { value: "abc" } });

    expect(input.value).toBe(floor);
  });
});

describe("SecurityPanel — Require 2FA for roles", () => {
  it("renders three distinct checkboxes with human role labels", async () => {
    vi.mocked(fetchSecuritySettings).mockResolvedValue(baseSettings);
    renderWithToastAndRouter(<SecurityPanel />);

    const superadmin = await screen.findByLabelText<HTMLInputElement>("Superadmin");
    expect(superadmin.checked).toBe(true);
    expect(screen.getByLabelText<HTMLInputElement>("Administrator").checked).toBe(false);
    expect(screen.getByLabelText<HTMLInputElement>("Operator").checked).toBe(false);
  });

  it("toggling a role saves the API slug, not the display label", async () => {
    vi.mocked(fetchSecuritySettings).mockResolvedValue(baseSettings);
    vi.mocked(patchSecuritySettings).mockResolvedValue({
      ...baseSettings,
      mfa_required_roles: { value: ["superadmin", "operator"], source: "db" as const },
    });
    renderWithToastAndRouter(<SecurityPanel />);

    fireEvent.click(await screen.findByLabelText("Operator"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(patchSecuritySettings).toHaveBeenCalledWith({
        mfa_required_roles: ["superadmin", "operator"],
      }),
    );
  });

  it("env-locked roles render as a disabled but readable group", async () => {
    vi.mocked(fetchSecuritySettings).mockResolvedValue({
      ...baseSettings,
      mfa_required_roles: { value: ["superadmin", "admin"], source: "env" as const },
    });
    renderWithToastAndRouter(<SecurityPanel />);

    const superadmin = await screen.findByLabelText<HTMLInputElement>("Superadmin");
    // <fieldset disabled> disables descendants functionally without reflecting
    // on each input's .disabled property — assert on the fieldset itself.
    expect(superadmin.closest("fieldset")!.disabled).toBe(true);
    expect(superadmin.checked).toBe(true);
  });

  it("warns when no roles are selected", async () => {
    vi.mocked(fetchSecuritySettings).mockResolvedValue(baseSettings);
    renderWithToastAndRouter(<SecurityPanel />);

    fireEvent.click(await screen.findByLabelText("Superadmin"));
    expect(screen.getByRole("alert").textContent).toContain("2FA is disabled for all roles");
  });
});
