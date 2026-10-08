// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SecurityAuditLogEntryDto } from "../../../src/api/types.js";
import type { OptionsLoad } from "../../../src/hooks/useOptionsLoad.js";
import { RecentLogins } from "../../../src/pages/users/RecentLogins.js";
import { SLOW_NOTICE_TEXT } from "../../../src/utils/loading-timing.js";
import { advanceTimers } from "../../test-utils.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const waiting: OptionsLoad<SecurityAuditLogEntryDto> = { items: [], loading: true, error: null, retry: vi.fn(), retrying: false, slow: false };

describe("RecentLogins while the logins are read", () => {
  it("holds three rows' room for 200ms, then draws them, with no note until the lookup is slow", async () => {
    vi.useFakeTimers();
    render(<RecentLogins logins={waiting} />);
    const place = () => screen.getByLabelText("Loading recent logins");
    expect(place().className).toContain("at-loading-hold");
    await advanceTimers(200);
    expect(place().className).not.toContain("at-loading-hold");
    expect(screen.queryByText(SLOW_NOTICE_TEXT)).toBeNull();
  });

  it("says, in the placeholder's status region, that it is taking longer than usual once the lookup is slow", async () => {
    vi.useFakeTimers();
    render(<RecentLogins logins={{ ...waiting, slow: true }} />);
    await advanceTimers(200);

    const note = screen.getByText(SLOW_NOTICE_TEXT);
    expect(screen.getByLabelText("Loading recent logins").contains(note)).toBe(true);
    // Never "No recent logins" for a read that has not answered.
    expect(screen.queryByText("No recent logins")).toBeNull();
  });
});
