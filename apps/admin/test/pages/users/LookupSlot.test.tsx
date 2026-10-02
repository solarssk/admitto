// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LookupSlot } from "../../../src/pages/users/LookupSlot.js";
import { advanceTimers } from "../../test-utils.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const idle = { loading: false, error: null, retry: vi.fn(), retrying: false };

describe("LookupSlot", () => {
  it("shows the field when the lookup has answered", () => {
    render(
      <LookupSlot lookup={idle} label="events">
        <button type="button">The field</button>
      </LookupSlot>,
    );
    expect(screen.getByRole("button", { name: "The field" })).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("holds the field's room, invisible for 200ms, then draws a placeholder, and keeps it for 400ms", async () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <LookupSlot lookup={{ ...idle, loading: true }} label="events">
        <button type="button">The field</button>
      </LookupSlot>,
    );
    const place = () => screen.queryByLabelText("Loading events");
    expect(place()?.className).toContain("at-loading-hold");
    expect(screen.queryByRole("button", { name: "The field" })).toBeNull();
    await advanceTimers(200);
    expect(place()?.className).not.toContain("at-loading-hold");

    rerender(
      <LookupSlot lookup={idle} label="events">
        <button type="button">The field</button>
      </LookupSlot>,
    );
    expect(place()).not.toBeNull();
    await advanceTimers(400);
    expect(place()).toBeNull();
    expect(screen.getByRole("button", { name: "The field" })).toBeTruthy();
  });

  it("shows the field with a one-line alert and a Retry that reruns the lookup when it failed", () => {
    const retry = vi.fn();
    render(
      <LookupSlot lookup={{ ...idle, error: "Could not load events.", retry }} label="events">
        <button type="button">The field</button>
      </LookupSlot>,
    );
    expect(screen.getByRole("button", { name: "The field" })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Could not load events.");
    fireEvent.click(screen.getByRole("button", { name: /^Retry/ }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("leaves the failure to the caller when it says so", () => {
    render(
      <LookupSlot lookup={{ ...idle, error: "Could not load events." }} label="events" showHint={false}>
        <button type="button">The field</button>
      </LookupSlot>,
    );
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("button", { name: "The field" })).toBeTruthy();
  });

  it("marks the Retry as busy while it works", async () => {
    await act(async () => {
      render(
        <LookupSlot lookup={{ ...idle, error: "Could not load events.", retrying: true }} label="events">
          <span />
        </LookupSlot>,
      );
    });
    expect(screen.getByRole("button", { name: /^Retry/ }).getAttribute("aria-busy")).toBe("true");
  });
});
