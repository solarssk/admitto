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

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node as T;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SecurityPanel — passkey sign-in", () => {
  it("renders both switches with the persisted state", async () => {
    vi.mocked(fetchSecuritySettings).mockResolvedValue(baseSettings);
    renderWithToastAndRouter(<SecurityPanel />);

    await screen.findByText("Passkey / security key sign-in");
    expect(el<HTMLInputElement>("security-webauthn-enabled").checked).toBe(true);
    expect(el<HTMLInputElement>("security-passkey-login-enabled").checked).toBe(false);
  });

  it("gives each switch a stable, descriptive accessible name instead of just \"On\"/\"Off\"", async () => {
    vi.mocked(fetchSecuritySettings).mockResolvedValue(baseSettings);
    renderWithToastAndRouter(<SecurityPanel />);

    await screen.findByText("Passkey / security key sign-in");
    expect(
      screen.getByRole("switch", { name: "Passkey / security key sign-in" }),
    ).toBe(el<HTMLInputElement>("security-webauthn-enabled"));
    expect(
      screen.getByRole("switch", { name: "Passkey sign-in on the login page" }),
    ).toBe(el<HTMLInputElement>("security-passkey-login-enabled"));
  });

  it("saves passkey_login_enabled when toggled on", async () => {
    vi.mocked(fetchSecuritySettings).mockResolvedValue(baseSettings);
    vi.mocked(patchSecuritySettings).mockResolvedValue({
      ...baseSettings,
      passkey_login_enabled: { value: true, source: "db" as const },
    });
    renderWithToastAndRouter(<SecurityPanel />);

    await screen.findByText("Passkey / security key sign-in");
    fireEvent.click(el<HTMLInputElement>("security-passkey-login-enabled"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(patchSecuritySettings).toHaveBeenCalledWith({ passkey_login_enabled: true }),
    );
  });

  it("disables the login-page switch when passkey sign-in itself is turned off in the draft", async () => {
    vi.mocked(fetchSecuritySettings).mockResolvedValue({
      ...baseSettings,
      passkey_login_enabled: { value: true, source: "default" as const },
    });
    renderWithToastAndRouter(<SecurityPanel />);

    await screen.findByText("Passkey / security key sign-in");
    expect(el<HTMLInputElement>("security-passkey-login-enabled").disabled).toBe(false);

    fireEvent.click(el<HTMLInputElement>("security-webauthn-enabled"));
    expect(el<HTMLInputElement>("security-passkey-login-enabled").disabled).toBe(true);
  });

  it("env-locked passkey_login_enabled renders as a disabled switch", async () => {
    vi.mocked(fetchSecuritySettings).mockResolvedValue({
      ...baseSettings,
      passkey_login_enabled: { value: true, source: "env" as const },
    });
    renderWithToastAndRouter(<SecurityPanel />);

    await screen.findByText("Passkey / security key sign-in");
    expect(el<HTMLInputElement>("security-passkey-login-enabled").disabled).toBe(true);
    expect(el<HTMLInputElement>("security-passkey-login-enabled").checked).toBe(true);
  });
});
