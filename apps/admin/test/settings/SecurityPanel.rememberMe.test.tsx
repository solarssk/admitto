// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SecurityPanel } from "../../src/settings/SecurityPanel.js";
import { renderWithToastAndRouter } from "../test-utils.js";

const baseSettings = {
  session_ttl_ms: { value: 86_400_000, source: "default" as const },
  operator_session_ttl_ms: { value: 43_200_000, source: "default" as const },
  session_idle_timeout_ms: { value: 1_800_000, source: "default" as const },
  operator_session_idle_timeout_ms: { value: 7_200_000, source: "default" as const },
  trusted_device_days: { value: 30, source: "default" as const },
  operator_remember_me_days: { value: 3, source: "default" as const },
  mfa_required_roles: { value: ["superadmin"], source: "default" as const },
  instance_url: { value: null as string | null, source: "default" as const },
  csp_trusted_origins: { value: [] as string[], source: "default" as const },
  webauthn_enabled: { value: true, source: "default" as const },
  passkey_login_enabled: { value: false, source: "default" as const },
  passkey_conditional_ui_enabled: { value: false, source: "default" as const },
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

const LABEL = 'Operator "Keep me signed in" duration (days)';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SecurityPanel: operator Keep me signed in duration", () => {
  it("shows the persisted number of days with its 0 to 14 range", async () => {
    vi.mocked(fetchSecuritySettings).mockResolvedValue(baseSettings);
    renderWithToastAndRouter(<SecurityPanel />);

    const input = (await screen.findByLabelText(LABEL)) as HTMLInputElement;
    expect(input.value).toBe("3");
    expect(input.min).toBe("0");
    expect(input.max).toBe("14");
    expect(input.disabled).toBe(false);
    expect(screen.getByText(/Set 0 to hide the checkbox/)).toBeTruthy();
  });

  it("saves only operator_remember_me_days when it is changed", async () => {
    vi.mocked(fetchSecuritySettings).mockResolvedValue(baseSettings);
    vi.mocked(patchSecuritySettings).mockResolvedValue({
      ...baseSettings,
      operator_remember_me_days: { value: 7, source: "db" as const },
    });
    renderWithToastAndRouter(<SecurityPanel />);

    const input = await screen.findByLabelText(LABEL);
    fireEvent.change(input, { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(patchSecuritySettings).toHaveBeenCalledWith({ operator_remember_me_days: 7 }),
    );
  });

  it("is read-only when the value is locked by the environment", async () => {
    vi.mocked(fetchSecuritySettings).mockResolvedValue({
      ...baseSettings,
      operator_remember_me_days: { value: 5, source: "env" as const },
    });
    renderWithToastAndRouter(<SecurityPanel />);

    const input = (await screen.findByLabelText(LABEL)) as HTMLInputElement;
    expect(input.value).toBe("5");
    expect(input.disabled).toBe(true);
  });
});
