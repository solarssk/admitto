// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SecurityPanel } from "../../src/settings/SecurityPanel.js";
import { renderWithToastAndRouter, isOff } from "../test-utils.js";

const baseSettings = {
  session_ttl_ms: { value: 86_400_000, source: "default" as const },
  operator_session_ttl_ms: { value: 43_200_000, source: "default" as const },
  session_idle_timeout_ms: { value: 1_800_000, source: "default" as const },
  operator_session_idle_timeout_ms: { value: 7_200_000, source: "default" as const },
  trusted_device_days: { value: 30, source: "default" as const },
  operator_event_day_sessions: { value: true, source: "default" as const },
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

const SWITCH_NAME = "Operators stay signed in on event day";

function eventDaySwitch(): HTMLInputElement {
  return screen.getByRole("switch", { name: SWITCH_NAME });
}

function switchLabelText(input: HTMLInputElement): string {
  return input.closest("label")?.textContent ?? "";
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SecurityPanel: operators stay signed in on event day", () => {
  it("renders the row with its description and no longer offers the old numeric duration", async () => {
    vi.mocked(fetchSecuritySettings).mockResolvedValue(baseSettings);
    renderWithToastAndRouter(<SecurityPanel />);

    await screen.findByText(SWITCH_NAME, { selector: "strong" });
    expect(screen.getByText(/if they sign in on\s+the day of an event they are assigned to/)).toBeTruthy();
    expect(screen.getByText(/06:00 the next morning, or the\s+event's end if later/)).toBeTruthy();
    expect(screen.getByText(/Not\s+for administrators/)).toBeTruthy();
    expect(eventDaySwitch().id).toBe("security-operator-event-day-sessions");
    expect(screen.queryByLabelText(/Keep me signed in/)).toBeNull();
  });

  it("shows On when the setting is true and Off when it is false", async () => {
    vi.mocked(fetchSecuritySettings).mockResolvedValue(baseSettings);
    const { unmount } = renderWithToastAndRouter(<SecurityPanel />);

    await screen.findByRole("switch", { name: SWITCH_NAME });
    expect(eventDaySwitch().checked).toBe(true);
    expect(switchLabelText(eventDaySwitch())).toBe("On");
    unmount();

    vi.mocked(fetchSecuritySettings).mockResolvedValue({
      ...baseSettings,
      operator_event_day_sessions: { value: false, source: "db" as const },
    });
    renderWithToastAndRouter(<SecurityPanel />);

    await screen.findByRole("switch", { name: SWITCH_NAME });
    expect(eventDaySwitch().checked).toBe(false);
    expect(switchLabelText(eventDaySwitch())).toBe("Off");
  });

  it("saves only operator_event_day_sessions: false after the switch is turned off", async () => {
    vi.mocked(fetchSecuritySettings).mockResolvedValue(baseSettings);
    vi.mocked(patchSecuritySettings).mockResolvedValue({
      ...baseSettings,
      operator_event_day_sessions: { value: false, source: "db" as const },
    });
    renderWithToastAndRouter(<SecurityPanel />);

    await screen.findByRole("switch", { name: SWITCH_NAME });
    const save = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(isOff(save)).toBe(true);

    fireEvent.click(eventDaySwitch());
    expect(eventDaySwitch().checked).toBe(false);
    expect(switchLabelText(eventDaySwitch())).toBe("Off");
    expect(save.disabled).toBe(false);
    fireEvent.click(save);

    await waitFor(() =>
      expect(patchSecuritySettings).toHaveBeenCalledWith({ operator_event_day_sessions: false }),
    );
    expect(patchSecuritySettings).toHaveBeenCalledTimes(1);
  });

  it("saves operator_event_day_sessions: true after an explicitly disabled setting is switched back on", async () => {
    vi.mocked(fetchSecuritySettings).mockResolvedValue({
      ...baseSettings,
      operator_event_day_sessions: { value: false, source: "db" as const },
    });
    vi.mocked(patchSecuritySettings).mockResolvedValue({
      ...baseSettings,
      operator_event_day_sessions: { value: true, source: "db" as const },
    });
    renderWithToastAndRouter(<SecurityPanel />);

    await screen.findByRole("switch", { name: SWITCH_NAME });
    fireEvent.click(eventDaySwitch());
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(patchSecuritySettings).toHaveBeenCalledWith({ operator_event_day_sessions: true }),
    );
  });

  it("is a disabled switch when the value is locked by the environment", async () => {
    vi.mocked(fetchSecuritySettings).mockResolvedValue({
      ...baseSettings,
      operator_event_day_sessions: { value: false, source: "env" as const },
    });
    renderWithToastAndRouter(<SecurityPanel />);

    await screen.findByRole("switch", { name: SWITCH_NAME });
    expect(eventDaySwitch().disabled).toBe(true);
    expect(eventDaySwitch().checked).toBe(false);
    expect(switchLabelText(eventDaySwitch())).toBe("Off");
  });
});
