// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CustomColumnsStatus } from "../../src/import/CustomColumnsStatus.js";
import { SLOW_NOTICE_TEXT } from "../../src/utils/loading-timing.js";
import { advanceTimers } from "../test-utils.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const waiting = { loading: true, error: null, retry: vi.fn(), retrying: false, slow: false };

describe("CustomColumnsStatus while the event's columns are read", () => {
  it("holds its room for 200ms, then draws a placeholder, with no note until the lookup is slow", async () => {
    vi.useFakeTimers();
    render(<CustomColumnsStatus lookup={waiting} />);
    const place = () => screen.getByLabelText("Loading custom columns");
    expect(place().className).toContain("at-loading-hold");
    await advanceTimers(200);
    expect(place().className).not.toContain("at-loading-hold");
    expect(screen.queryByText(SLOW_NOTICE_TEXT)).toBeNull();
  });

  it("says, in the placeholder's status region, that it is taking longer than usual once the lookup is slow", async () => {
    vi.useFakeTimers();
    render(<CustomColumnsStatus lookup={{ ...waiting, slow: true }} />);
    await advanceTimers(200);

    const note = screen.getByText(SLOW_NOTICE_TEXT);
    expect(screen.getByLabelText("Loading custom columns").contains(note)).toBe(true);
  });

  it("shows nothing when the columns are in, and a hint with a Retry when the read failed", () => {
    const { rerender } = render(<CustomColumnsStatus lookup={{ ...waiting, loading: false }} />);
    expect(screen.queryByLabelText("Loading custom columns")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();

    rerender(<CustomColumnsStatus lookup={{ ...waiting, loading: false, error: "Could not load custom columns." }} />);
    expect(screen.getByRole("alert").textContent).toContain("Could not load custom columns.");
    expect(screen.getByRole("button", { name: "Retry loading custom columns" })).toBeTruthy();
  });
});
