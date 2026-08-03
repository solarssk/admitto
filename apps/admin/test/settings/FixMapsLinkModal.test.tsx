// @vitest-environment jsdom
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LocationValidationError } from "@admitto/location";
import { FixMapsLinkModal } from "../../src/settings/FixMapsLinkModal.js";
import { renderWithToast } from "../test-utils.js";

vi.mock("@admitto/location", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@admitto/location")>();
  return {
    ...actual,
    normalizeMapsUrlOverride: vi.fn(actual.normalizeMapsUrlOverride),
  };
});

import { normalizeMapsUrlOverride } from "@admitto/location";

const mockNormalize = vi.mocked(normalizeMapsUrlOverride);

beforeEach(async () => {
  const actual = await vi.importActual<typeof import("@admitto/location")>("@admitto/location");
  mockNormalize.mockImplementation(actual.normalizeMapsUrlOverride);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const emptyInitial = {
  google_maps_url_override: "",
  apple_maps_url_override: "",
};

describe("FixMapsLinkModal", () => {
  it("does not render when closed", () => {
    renderWithToast(
      <FixMapsLinkModal open={false} initial={emptyInitial} onClose={vi.fn()} onApply={vi.fn()} />,
    );
    expect(screen.queryByRole("heading", { name: "Fix a wrong map link" })).toBeNull();
  });

  it("calls onClose when Cancel is clicked", () => {
    const onClose = vi.fn();
    renderWithToast(
      <FixMapsLinkModal open initial={emptyInitial} onClose={onClose} onApply={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("applies normalized URLs and closes on Apply links", () => {
    const onApply = vi.fn();
    const onClose = vi.fn();
    renderWithToast(
      <FixMapsLinkModal open initial={emptyInitial} onClose={onClose} onApply={onApply} />,
    );
    fireEvent.change(screen.getByLabelText("Google Maps link"), {
      target: { value: "https://www.google.com/maps/place/Hall" },
    });
    fireEvent.change(screen.getByLabelText("Apple Maps link"), {
      target: { value: "https://maps.apple.com/?ll=52.2,21.0" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply links" }));
    expect(onApply).toHaveBeenCalledWith({
      google_maps_url_override: "https://www.google.com/maps/place/Hall",
      apple_maps_url_override: "https://maps.apple.com/?ll=52.2,21.0",
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows field errors for invalid Maps hosts and does not apply", () => {
    const onApply = vi.fn();
    renderWithToast(
      <FixMapsLinkModal open initial={emptyInitial} onClose={vi.fn()} onApply={onApply} />,
    );
    fireEvent.change(screen.getByLabelText("Google Maps link"), {
      target: { value: "https://evil.example/maps" },
    });
    fireEvent.change(screen.getByLabelText("Apple Maps link"), {
      target: { value: "https://evil.example/apple" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply links" }));
    expect(onApply).not.toHaveBeenCalled();
    expect(document.querySelectorAll(".at-hint--error").length).toBeGreaterThanOrEqual(1);
  });

  it("clears the Apple field error when the user edits the field", () => {
    renderWithToast(
      <FixMapsLinkModal open initial={emptyInitial} onClose={vi.fn()} onApply={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText("Apple Maps link"), {
      target: { value: "https://evil.example/x" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply links" }));
    expect(document.querySelectorAll(".at-hint--error").length).toBeGreaterThanOrEqual(1);

    fireEvent.change(screen.getByLabelText("Apple Maps link"), {
      target: { value: "https://maps.apple.com/?ll=1,2" },
    });
    // Editing clears the inline error state; Apply is not clicked again.
    expect(document.querySelectorAll(".at-hint--error")).toHaveLength(0);
  });

  it("shows Remove overrides when an initial override is set and clears both on click", () => {
    const onApply = vi.fn();
    const onClose = vi.fn();
    renderWithToast(
      <FixMapsLinkModal
        open
        initial={{
          google_maps_url_override: "https://www.google.com/maps/place/X",
          apple_maps_url_override: "",
        }}
        onClose={onClose}
        onApply={onApply}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove overrides" }));
    expect(onApply).toHaveBeenCalledWith({
      google_maps_url_override: "",
      apple_maps_url_override: "",
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("uses LocationValidationError.message when normalization rejects", () => {
    mockNormalize.mockImplementationOnce(() => {
      throw new LocationValidationError("Google Maps link must use an allowlisted host.");
    });
    renderWithToast(
      <FixMapsLinkModal open initial={emptyInitial} onClose={vi.fn()} onApply={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText("Google Maps link"), {
      target: { value: "https://www.google.com/maps/place/X" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply links" }));
    expect(screen.getByText("Google Maps link must use an allowlisted host.")).toBeTruthy();
  });

  it("falls back to a generic invalid message for unexpected throw types", () => {
    mockNormalize.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    renderWithToast(
      <FixMapsLinkModal open initial={emptyInitial} onClose={vi.fn()} onApply={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText("Google Maps link"), {
      target: { value: "https://www.google.com/maps/place/X" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply links" }));
    expect(screen.getByText("Google Maps link is invalid")).toBeTruthy();
  });
});
