// @vitest-environment jsdom
import { useState } from "react";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VenueAutocomplete } from "../../src/components/VenueAutocomplete.js";
import type { GeocodingResultDto, GeocodingSearchResponse } from "../../src/api/types.js";
import { renderWithToast } from "../test-utils.js";

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    searchGeocoding: vi.fn(),
  };
});

import { searchGeocoding } from "../../src/api/client.js";

const mockSearch = vi.mocked(searchGeocoding);

function makeResult(overrides: Partial<GeocodingResultDto> = {}): GeocodingResultDto {
  return {
    name: "10 Downing Street",
    formatted_address: "10 Downing Street, London",
    latitude: 51.5034,
    longitude: -0.1276,
    provider: "nominatim",
    ...overrides,
  };
}

/** Deferred promise so a test can control exactly when a search "resolves". */
function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function Harness({
  disabled = false,
  onSelectResult = () => {},
  onContactConfigured,
  showFindButton = true,
}: {
  disabled?: boolean;
  onSelectResult?: (result: GeocodingResultDto) => void;
  onContactConfigured?: (configured: boolean) => void;
  showFindButton?: boolean;
}) {
  const [value, setValue] = useState("");
  return (
    <VenueAutocomplete
      id="venue"
      label="Venue name or address"
      value={value}
      disabled={disabled}
      onChange={setValue}
      onSelectResult={onSelectResult}
      onContactConfigured={onContactConfigured}
      showFindButton={showFindButton}
    />
  );
}

beforeEach(() => {
  mockSearch.mockReset();
  mockSearch.mockResolvedValue({ results: [], contact_configured: true });
});

afterEach(cleanup);

describe("VenueAutocomplete", () => {
  it("renders the label and reflects the controlled value", () => {
    renderWithToast(<Harness />);
    expect((screen.getByLabelText("Venue name or address") as HTMLInputElement).value).toBe("");
  });

  it("calls onChange on every keystroke", () => {
    renderWithToast(<Harness />);
    const input = screen.getByLabelText("Venue name or address");
    fireEvent.change(input, { target: { value: "H" } });
    expect((input as HTMLInputElement).value).toBe("H");
  });

  it("disables the input when the disabled prop is true", () => {
    renderWithToast(<Harness disabled />);
    expect((screen.getByLabelText("Venue name or address") as HTMLInputElement).disabled).toBe(true);
  });

  it("does not search below the two-character minimum", async () => {
    renderWithToast(<Harness />);
    fireEvent.change(screen.getByLabelText("Venue name or address"), { target: { value: "H" } });

    // Give the debounce window time to elapse; a query this short must never reach the API.
    await new Promise((r) => setTimeout(r, 400));
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it("searches (debounced) once the query reaches the minimum length", async () => {
    mockSearch.mockResolvedValue({ results: [makeResult()], contact_configured: true });
    renderWithToast(<Harness />);
    fireEvent.change(screen.getByLabelText("Venue name or address"), {
      target: { value: "Downing St" },
    });

    await waitFor(() => expect(mockSearch).toHaveBeenCalledWith("Downing St"));
    expect(await screen.findByText("10 Downing Street")).toBeTruthy();
  });

  it("trims surrounding whitespace before searching", async () => {
    renderWithToast(<Harness />);
    fireEvent.change(screen.getByLabelText("Venue name or address"), {
      target: { value: "  Downing St  " },
    });
    await waitFor(() => expect(mockSearch).toHaveBeenCalledWith("Downing St"));
  });

  it("shows both name and address for a named venue, and lets the admin pick it", async () => {
    const onSelectResult = vi.fn();
    mockSearch.mockResolvedValue({ results: [makeResult()], contact_configured: true });
    renderWithToast(<Harness onSelectResult={onSelectResult} />);
    fireEvent.change(screen.getByLabelText("Venue name or address"), {
      target: { value: "Downing St" },
    });

    const hit = await screen.findByRole("button", { name: /10 Downing Street/ });
    expect(screen.getByText("10 Downing Street, London")).toBeTruthy();

    // mousedown preventDefault keeps the input focused so the click can select the hit.
    fireEvent.mouseDown(hit);
    fireEvent.click(hit);
    expect(onSelectResult).toHaveBeenCalledWith(makeResult());
    // Picking a result closes the dropdown immediately.
    expect(screen.queryByRole("list", { name: "Venue suggestions" })).toBeFalsy();
  });

  it("falls back to the formatted address as the heading for address-only matches", async () => {
    mockSearch.mockResolvedValue({
      results: [makeResult({ name: undefined, formatted_address: "221B Baker Street, London" })],
      contact_configured: true,
    });
    renderWithToast(<Harness />);
    fireEvent.change(screen.getByLabelText("Venue name or address"), {
      target: { value: "Baker St" },
    });

    expect(await screen.findByText("221B Baker Street, London")).toBeTruthy();
  });

  it("silently ignores a failed search - the field stays usable", async () => {
    mockSearch.mockRejectedValue(new Error("network down"));
    renderWithToast(<Harness />);
    fireEvent.change(screen.getByLabelText("Venue name or address"), {
      target: { value: "Downing St" },
    });

    await waitFor(() => expect(mockSearch).toHaveBeenCalledWith("Downing St"));
    expect((screen.getByLabelText("Venue name or address") as HTMLInputElement).value).toBe(
      "Downing St",
    );
    expect(screen.queryByText(/fail/i)).toBeFalsy();
  });

  it("reports contact_configured from each search response", async () => {
    const onContactConfigured = vi.fn();
    mockSearch.mockResolvedValue({ results: [makeResult()], contact_configured: false });
    renderWithToast(<Harness onContactConfigured={onContactConfigured} />);
    fireEvent.change(screen.getByLabelText("Venue name or address"), {
      target: { value: "Downing St" },
    });

    await waitFor(() => expect(onContactConfigured).toHaveBeenCalledWith(false));
  });

  it("ignores a stale response that resolves after a newer search already completed", async () => {
    const first = createDeferred<GeocodingSearchResponse>();
    const second = createDeferred<GeocodingSearchResponse>();
    mockSearch.mockImplementationOnce(() => first.promise);
    mockSearch.mockImplementationOnce(() => second.promise);
    renderWithToast(<Harness />);
    const input = screen.getByLabelText("Venue name or address");

    fireEvent.change(input, { target: { value: "Downing" } });
    await waitFor(() => expect(mockSearch).toHaveBeenNthCalledWith(1, "Downing"));

    fireEvent.change(input, { target: { value: "Downing Street" } });
    await waitFor(() => expect(mockSearch).toHaveBeenNthCalledWith(2, "Downing Street"));

    // The newer request resolves first, as would happen if the first, now-stale request were
    // slow (e.g. a slower upstream Nominatim response for the shorter query).
    second.resolve({ results: [makeResult({ name: "Correct match" })], contact_configured: true });
    expect(await screen.findByText("Correct match")).toBeTruthy();

    // The stale first request resolving afterwards must not clobber the newer results.
    first.resolve({ results: [makeResult({ name: "Stale match" })], contact_configured: true });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText("Stale match")).toBeFalsy();
    expect(screen.getByText("Correct match")).toBeTruthy();
  });

  it("also ignores a stale rejection after a newer search completes", async () => {
    const first = createDeferred<GeocodingSearchResponse>();
    mockSearch.mockImplementationOnce(() => first.promise);
    mockSearch.mockResolvedValueOnce({
      results: [makeResult({ name: "Correct match" })],
      contact_configured: true,
    });
    renderWithToast(<Harness />);
    const input = screen.getByLabelText("Venue name or address");

    fireEvent.change(input, { target: { value: "Downing" } });
    await waitFor(() => expect(mockSearch).toHaveBeenNthCalledWith(1, "Downing"));
    fireEvent.change(input, { target: { value: "Downing Street" } });
    await waitFor(() => expect(mockSearch).toHaveBeenNthCalledWith(2, "Downing Street"));
    expect(await screen.findByText("Correct match")).toBeTruthy();

    first.reject(new Error("stale request failed"));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(screen.getByText("Correct match")).toBeTruthy();
  });

  it("clears a pending debounce timer when unmounted", () => {
    vi.useFakeTimers();
    const rendered = renderWithToast(<Harness />);
    fireEvent.change(screen.getByLabelText("Venue name or address"), {
      target: { value: "Downing Street" },
    });

    rendered.unmount();
    vi.advanceTimersByTime(500);

    expect(mockSearch).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("clears a pending blur timer when unmounted", async () => {
    vi.useFakeTimers();
    mockSearch.mockResolvedValue({ results: [makeResult()], contact_configured: true });
    const rendered = renderWithToast(<Harness />);
    const input = screen.getByLabelText("Venue name or address");
    fireEvent.change(input, { target: { value: "Downing St" } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });
    expect(screen.getByText("10 Downing Street")).toBeTruthy();

    fireEvent.blur(input);
    rendered.unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    vi.useRealTimers();
  });

  it("closes the dropdown on Escape without clearing the typed text", async () => {
    mockSearch.mockResolvedValue({ results: [makeResult()], contact_configured: true });
    renderWithToast(<Harness />);
    const input = screen.getByLabelText("Venue name or address");
    fireEvent.change(input, { target: { value: "Downing St" } });
    await screen.findByText("10 Downing Street");

    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("list", { name: "Venue suggestions" })).toBeFalsy();
    expect((input as HTMLInputElement).value).toBe("Downing St");
  });

  it("closes the dropdown shortly after blur, and reopens on focus if results are cached", async () => {
    mockSearch.mockResolvedValue({ results: [makeResult()], contact_configured: true });
    renderWithToast(<Harness />);
    const input = screen.getByLabelText("Venue name or address");
    fireEvent.change(input, { target: { value: "Downing St" } });
    await screen.findByText("10 Downing Street");

    fireEvent.blur(input);
    await waitFor(() => expect(screen.queryByText("10 Downing Street")).toBeFalsy());

    fireEvent.focus(input);
    expect(screen.getByText("10 Downing Street")).toBeTruthy();
  });

  it("keeps the dropdown open when focus returns before the blur timer fires", async () => {
    mockSearch.mockResolvedValue({ results: [makeResult()], contact_configured: true });
    renderWithToast(<Harness />);
    const input = screen.getByLabelText("Venue name or address");
    fireEvent.change(input, { target: { value: "Downing St" } });
    await screen.findByText("10 Downing Street");

    fireEvent.blur(input);
    fireEvent.focus(input);
    // Still within the 150ms blur delay — focus must cancel that timer.
    await new Promise((resolve) => window.setTimeout(resolve, 200));
    expect(screen.getByText("10 Downing Street")).toBeTruthy();
  });

  it("does not reopen suggestions on focus when the cached result list is empty", () => {
    renderWithToast(<Harness />);
    const input = screen.getByLabelText("Venue name or address");

    fireEvent.focus(input);

    expect(input.getAttribute("aria-expanded")).toBe("false");
  });

  it("Find on map runs search immediately and shows a no-match notice", async () => {
    mockSearch.mockResolvedValue({ results: [], contact_configured: true });
    renderWithToast(<Harness />);
    fireEvent.change(screen.getByLabelText("Venue name or address"), {
      target: { value: "Nowhere Hall" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Find on map" }));

    expect(await screen.findByText(/No match found on OpenStreetMap/)).toBeTruthy();
    expect(mockSearch).toHaveBeenCalledWith("Nowhere Hall");
  });

  it("Find on map with a too-short query does not claim a search failure", async () => {
    renderWithToast(<Harness />);
    fireEvent.change(screen.getByLabelText("Venue name or address"), {
      target: { value: "a" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Find on map" }));

    expect(screen.queryByText(/No match found on OpenStreetMap/)).toBeNull();
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it("runs Find on map when Enter is pressed", async () => {
    mockSearch.mockResolvedValue({ results: [], contact_configured: true });
    renderWithToast(<Harness />);
    const input = screen.getByLabelText("Venue name or address");
    fireEvent.change(input, { target: { value: "Nowhere Hall" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(await screen.findByText(/No match found on OpenStreetMap/)).toBeTruthy();
    expect(mockSearch).toHaveBeenCalledWith("Nowhere Hall");
  });

  it("shows a safe error when Find on map fails", async () => {
    mockSearch.mockRejectedValue(new Error("upstream unavailable"));
    renderWithToast(<Harness />);
    fireEvent.change(screen.getByLabelText("Venue name or address"), {
      target: { value: "Downing St" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Find on map" }));

    expect(await screen.findByText("Address lookup failed. Try again shortly.")).toBeTruthy();
  });

  it("can omit the Find on map button", () => {
    renderWithToast(<Harness showFindButton={false} />);
    expect(screen.queryByRole("button", { name: "Find on map" })).toBeNull();
  });
});
