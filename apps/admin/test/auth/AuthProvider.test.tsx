// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/api/client.js";
import { AuthProvider } from "../../src/auth/AuthProvider.js";

vi.mock("../../src/api/client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/api/client.js")>();
  return {
    ...actual,
    fetchMe: vi.fn(),
    fetchStaffTheme: vi.fn(),
  };
});

vi.mock("@admitto/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@admitto/ui")>();
  return {
    ...actual,
    applyThemeVars: vi.fn(),
  };
});

import { fetchMe } from "../../src/api/client.js";

const mockFetchMe = vi.mocked(fetchMe);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AuthProvider", () => {
  it("shows EmptyState with Retry when session load fails", async () => {
    mockFetchMe.mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    render(
      <AuthProvider>
        <div data-testid="child">should not render</div>
      </AuthProvider>,
    );
    await waitFor(() => {
      expect(screen.getByText("Could not load session")).toBeTruthy();
    });
    expect(screen.getByText("Failed to load session")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.queryByTestId("child")).toBeNull();
  });

  it("retries session load when Retry is clicked", async () => {
    mockFetchMe
      .mockRejectedValueOnce(new ApiError(500, "secret_internal"))
      .mockResolvedValueOnce({
        user: {
          id: "u1",
          email: "a@example.com",
          display_name: "A",
          preferred_locale: "en",
          is_active: true,
          created_at: "2026-01-01T00:00:00.000Z",
        },
        assignments: [],
        device_label: null,
        session_active: true,
        setup_complete: true,
        mailer_status: null,
      });

    render(
      <AuthProvider>
        <div data-testid="child">ok</div>
      </AuthProvider>,
    );

    await screen.findByText("Could not load session");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(screen.getByTestId("child").textContent).toBe("ok");
    });
    expect(mockFetchMe).toHaveBeenCalledTimes(2);
  });
});
