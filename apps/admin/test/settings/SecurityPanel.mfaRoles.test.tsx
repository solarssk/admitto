// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SecurityPanel } from "../../src/settings/SecurityPanel.js";
import { renderWithToastAndRouter, getTooltipText } from "../test-utils.js";

const baseSettings = {
  session_ttl_ms: { value: 86_400_000, source: "default" as const },
  operator_session_ttl_ms: { value: 43_200_000, source: "default" as const },
  session_idle_timeout_ms: { value: 1_800_000, source: "default" as const },
  operator_session_idle_timeout_ms: { value: 7_200_000, source: "default" as const },
  trusted_device_days: { value: 30, source: "default" as const },
  mfa_required_roles: { value: ["superadmin"], source: "default" as const },
  instance_url: { value: null as string | null, source: "default" as const },
};

const MFA_EMPTY_WARNING =
  "Two-factor authentication is off for every role. Not recommended for production.";

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    fetchSecuritySettings: vi.fn(),
    patchSecuritySettings: vi.fn(),
  };
});

import { fetchSecuritySettings, patchSecuritySettings, ApiError } from "../../src/api/client.js";

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
    { label: "Operator session maximum lifetime (hours)", saved: "12" },
    { label: "Admin session maximum lifetime (hours)", saved: "24" },
    { label: "Admin session inactivity timeout (minutes)", saved: "30" },
    { label: "Operator session inactivity timeout (minutes)", saved: "120" },
    { label: "Remember device duration (days)", saved: "30" },
  ])("reverts a non-numeric $label to the saved value on blur", async ({ label, saved }) => {
    vi.mocked(fetchSecuritySettings).mockResolvedValue(baseSettings);
    renderWithToastAndRouter(<SecurityPanel />);

    const input = await screen.findByLabelText<HTMLInputElement>(label);
    fireEvent.change(input, { target: { value: "abc" } });
    fireEvent.blur(input);

    expect(input.value).toBe(saved);
  });

  it("allows typing intermediate digits below the minimum before blur commits", async () => {
    vi.mocked(fetchSecuritySettings).mockResolvedValue(baseSettings);
    renderWithToastAndRouter(<SecurityPanel />);

    const input = await screen.findByLabelText<HTMLInputElement>(
      "Admin session inactivity timeout (minutes)",
    );
    fireEvent.change(input, { target: { value: "3" } });
    expect(input.value).toBe("3");

    fireEvent.change(input, { target: { value: "30" } });
    fireEvent.blur(input);

    expect(input.value).toBe("30");
  });
});

describe("SecurityPanel — Authenticator app required by role", () => {
  it("renders three role switches with human role labels", async () => {
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

  it("env-locked roles render as disabled switches with the env badge", async () => {
    vi.mocked(fetchSecuritySettings).mockResolvedValue({
      ...baseSettings,
      mfa_required_roles: { value: ["superadmin", "admin"], source: "env" as const },
    });
    renderWithToastAndRouter(<SecurityPanel />);

    const superadmin = await screen.findByLabelText<HTMLInputElement>("Superadmin");
    expect(superadmin.disabled).toBe(true);
    expect(superadmin.checked).toBe(true);
    expect(screen.getByText("From environment")).toBeTruthy();
  });

  it("warns when no roles are selected", async () => {
    vi.mocked(fetchSecuritySettings).mockResolvedValue(baseSettings);
    renderWithToastAndRouter(<SecurityPanel />);

    fireEvent.click(await screen.findByLabelText("Superadmin"));
    const warning = screen.getByLabelText(MFA_EMPTY_WARNING);
    expect(getTooltipText(warning)).toContain("Two-factor authentication is off for every role");
  });
});

describe("SecurityPanel — dangerous-value inline warnings (P0-4)", () => {
  function warningTriggerFor(label: string): HTMLElement {
    const input = screen.getByLabelText<HTMLInputElement>(label);
    const trigger = input
      .closest(".security-settings-field")
      ?.querySelector(".security-field-warning-trigger");
    if (!trigger) throw new Error(`No warning trigger for ${label}`);
    return trigger as HTMLElement;
  }

  it("shows no warning for the default settings", async () => {
    vi.mocked(fetchSecuritySettings).mockResolvedValue(baseSettings);
    renderWithToastAndRouter(<SecurityPanel />);

    await screen.findByLabelText("Admin session maximum lifetime (hours)");
    expect(document.querySelector(".security-field-warning-trigger")).toBeNull();
  });

  it("warns when the admin absolute lifetime exceeds 24 hours", async () => {
    vi.mocked(fetchSecuritySettings).mockResolvedValue(baseSettings);
    renderWithToastAndRouter(<SecurityPanel />);

    const input = await screen.findByLabelText<HTMLInputElement>(
      "Admin session maximum lifetime (hours)",
    );
    fireEvent.change(input, { target: { value: "48" } });
    fireEvent.blur(input);

    expect(input.className).toContain("at-input--warn");
    expect(getTooltipText(warningTriggerFor("Admin session maximum lifetime (hours)"))).toContain(
      "Sessions longer than 24 hours",
    );
  });

  it("warns when the operator absolute lifetime exceeds 24 hours", async () => {
    vi.mocked(fetchSecuritySettings).mockResolvedValue(baseSettings);
    renderWithToastAndRouter(<SecurityPanel />);

    const input = await screen.findByLabelText<HTMLInputElement>(
      "Operator session maximum lifetime (hours)",
    );
    fireEvent.change(input, { target: { value: "48" } });
    fireEvent.blur(input);

    expect(input.className).toContain("at-input--warn");
    expect(getTooltipText(warningTriggerFor("Operator session maximum lifetime (hours)"))).toContain(
      "Sessions longer than 24 hours",
    );
  });

  it("warns when the admin inactivity timeout exceeds 2 hours", async () => {
    vi.mocked(fetchSecuritySettings).mockResolvedValue(baseSettings);
    renderWithToastAndRouter(<SecurityPanel />);

    const input = await screen.findByLabelText<HTMLInputElement>(
      "Admin session inactivity timeout (minutes)",
    );
    fireEvent.change(input, { target: { value: "180" } });
    fireEvent.blur(input);

    expect(input.className).toContain("at-input--warn");
    expect(getTooltipText(warningTriggerFor("Admin session inactivity timeout (minutes)"))).toContain(
      "unattended admin sessions",
    );
  });

  it("warns when the operator inactivity timeout exceeds 4 hours", async () => {
    vi.mocked(fetchSecuritySettings).mockResolvedValue(baseSettings);
    renderWithToastAndRouter(<SecurityPanel />);

    const input = await screen.findByLabelText<HTMLInputElement>(
      "Operator session inactivity timeout (minutes)",
    );
    fireEvent.change(input, { target: { value: "300" } });
    fireEvent.blur(input);

    expect(input.className).toContain("at-input--warn");
    expect(
      getTooltipText(warningTriggerFor("Operator session inactivity timeout (minutes)")),
    ).toContain("unattended check-in stations");
  });
});

describe("SecurityPanel — save and reset", () => {
  it("shows an info toast when Save is clicked with no draft changes", async () => {
    vi.mocked(fetchSecuritySettings).mockResolvedValue(baseSettings);
    renderWithToastAndRouter(<SecurityPanel />);

    fireEvent.click(await screen.findByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(patchSecuritySettings).not.toHaveBeenCalled();
      expect(screen.getByTestId("at-toast").textContent).toMatch(/No changes to save/);
    });
  });

  it("discards unsaved edits when Reset is clicked", async () => {
    vi.mocked(fetchSecuritySettings).mockResolvedValue(baseSettings);
    renderWithToastAndRouter(<SecurityPanel />);

    const input = await screen.findByLabelText<HTMLInputElement>(
      "Admin session maximum lifetime (hours)",
    );
    fireEvent.change(input, { target: { value: "48" } });
    fireEvent.blur(input);
    expect(input.value).toBe("48");

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(input.value).toBe("24");
  });

  it("retries after a load failure", async () => {
    vi.mocked(fetchSecuritySettings)
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce(baseSettings);
    renderWithToastAndRouter(<SecurityPanel />);

    fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
    await screen.findByLabelText("Admin session maximum lifetime (hours)");
    expect(fetchSecuritySettings).toHaveBeenCalledTimes(2);
  });
});

describe("SecurityPanel — idle-vs-absolute server error mapping", () => {
  it("toasts a friendly message when the server rejects idle > absolute lifetime", async () => {
    vi.mocked(fetchSecuritySettings).mockResolvedValue(baseSettings);
    vi.mocked(patchSecuritySettings).mockRejectedValueOnce(
      new ApiError(
        400,
        "idle_timeout_exceeds_absolute_lifetime",
        "idle_timeout_exceeds_absolute_lifetime",
      ),
    );
    renderWithToastAndRouter(<SecurityPanel />);

    const input = await screen.findByLabelText<HTMLInputElement>(
      "Admin session inactivity timeout (minutes)",
    );
    fireEvent.change(input, { target: { value: "60" } });
    fireEvent.blur(input);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByTestId("at-toast").textContent).toMatch(
        /Inactivity timeout cannot be longer than the maximum session lifetime/,
      );
    });
  });
});
