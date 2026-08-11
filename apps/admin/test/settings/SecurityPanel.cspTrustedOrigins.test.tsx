// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  csp_trusted_origins: { value: [] as string[], source: "default" as const },
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

beforeEach(() => {
  // jsdom does not implement scrollIntoView.
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function manageOriginsButton(): HTMLElement {
  return screen.getByRole("button", { name: "Manage origins" });
}

function warningTriggerForButton(): HTMLElement | null {
  return manageOriginsButton()
    .closest(".security-settings-item")
    ?.querySelector(".security-field-warning-trigger") as HTMLElement | null;
}

describe("SecurityPanel — trusted third-party script origins", () => {
  it("keeps the button label fixed and lists saved origins inside the modal", async () => {
    vi.mocked(fetchSecuritySettings).mockResolvedValue({
      ...baseSettings,
      csp_trusted_origins: { value: ["https://static.cloudflareinsights.com"], source: "db" },
    });
    renderWithToastAndRouter(<SecurityPanel />);

    const button = await screen.findByRole("button", { name: "Manage origins" });
    fireEvent.click(button);

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("https://static.cloudflareinsights.com")).toBeTruthy();
  });

  it("adds an origin in the modal and saves it from the panel", async () => {
    vi.mocked(fetchSecuritySettings).mockResolvedValue(baseSettings);
    vi.mocked(patchSecuritySettings).mockResolvedValue({
      ...baseSettings,
      csp_trusted_origins: { value: ["https://static.cloudflareinsights.com"], source: "db" },
    });
    renderWithToastAndRouter(<SecurityPanel />);

    fireEvent.click(await screen.findByRole("button", { name: "Manage origins" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Add an origin"), {
      target: { value: "https://static.cloudflareinsights.com" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add" }));
    expect(within(dialog).getByText("https://static.cloudflareinsights.com")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(patchSecuritySettings).toHaveBeenCalledWith({
        csp_trusted_origins: ["https://static.cloudflareinsights.com"],
      }),
    );
  });

  it("removes an origin in the modal", async () => {
    vi.mocked(fetchSecuritySettings).mockResolvedValue({
      ...baseSettings,
      csp_trusted_origins: { value: ["https://static.cloudflareinsights.com"], source: "db" },
    });
    renderWithToastAndRouter(<SecurityPanel />);

    fireEvent.click(await screen.findByRole("button", { name: "Manage origins" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /Remove/ }));
    expect(within(dialog).getByText("No trusted origins yet.")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));

    expect(screen.getByRole("button", { name: "Manage origins" })).toBeTruthy();
  });

  it("rejects an invalid origin inside the modal without adding it", async () => {
    vi.mocked(fetchSecuritySettings).mockResolvedValue(baseSettings);
    renderWithToastAndRouter(<SecurityPanel />);

    fireEvent.click(await screen.findByRole("button", { name: "Manage origins" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Add an origin"), {
      target: { value: "not-a-valid-origin" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add" }));

    expect(within(dialog).getByText(/not a valid https:\/\/ origin/)).toBeTruthy();
    expect(within(dialog).getByText("No trusted origins yet.")).toBeTruthy();
  });

  it("shows the security warning once an origin is saved", async () => {
    vi.mocked(fetchSecuritySettings).mockResolvedValue(baseSettings);
    renderWithToastAndRouter(<SecurityPanel />);

    await screen.findByRole("button", { name: "Manage origins" });
    expect(warningTriggerForButton()).toBeNull();

    fireEvent.click(manageOriginsButton());
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Add an origin"), {
      target: { value: "https://static.cloudflareinsights.com" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Done" }));

    const warning = warningTriggerForButton();
    expect(warning).not.toBeNull();
    expect(getTooltipText(warning as HTMLElement)).toContain("Only add origins you fully trust");
  });

  it("env-locked source disables the button and shows the env badge", async () => {
    vi.mocked(fetchSecuritySettings).mockResolvedValue({
      ...baseSettings,
      csp_trusted_origins: { value: ["https://env.example.com"], source: "env" },
    });
    renderWithToastAndRouter(<SecurityPanel />);

    const button = await screen.findByRole("button", { name: "Manage origins" });
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("From environment")).toBeTruthy();
  });
});
