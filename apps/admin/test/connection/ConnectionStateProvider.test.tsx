// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectionBanner, ConnectionStateProvider } from "../../src/connection/ConnectionStateProvider.js";
import { fetchMe } from "../../src/api/client.js";

vi.mock("../../src/api/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/api/client.js")>()),
  fetchMe: vi.fn(),
}));

const mockFetchMe = vi.mocked(fetchMe);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ConnectionStateProvider", () => {
  it("uses the successful auth bootstrap instead of immediately pinging /me again", () => {
    render(
      <ConnectionStateProvider initiallyConnected>
        <ConnectionBanner />
      </ConnectionStateProvider>,
    );

    expect(mockFetchMe).not.toHaveBeenCalled();
    expect(screen.queryByText(/not connected/i)).toBeNull();
  });
});
