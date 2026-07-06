// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
  it("shows operator-safe message when session load fails", async () => {
    mockFetchMe.mockRejectedValueOnce(new ApiError(500, "secret_internal"));
    render(
      <AuthProvider>
        <div data-testid="child">should not render</div>
      </AuthProvider>,
    );
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toBe("Failed to load session");
    });
    expect(screen.queryByTestId("child")).toBeNull();
  });
});
