import type { PrismaClient } from "@admitto/db";
import type { Context } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@admitto/location", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@admitto/location")>();
  return {
    ...actual,
    assertCoordinatePairing: vi.fn(actual.assertCoordinatePairing),
  };
});

import { assertCoordinatePairing } from "@admitto/location";
import { handleCreateEvent } from "../../src/admin/admin-api-routes.js";

function fakeContext(body: unknown): Context {
  return {
    req: {
      json: async () => body,
    },
    get: (key: string) => (key === "auth" ? { userId: "user-1" } : undefined),
    json: (payload: unknown, status?: number) => Response.json(payload, { status: status ?? 200 }),
  } as unknown as Context;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("handleCreateEvent — unexpected location validation failure", () => {
  it("rethrows a non-LocationValidationError from coordinate pairing", async () => {
    const unexpected = new Error("coordinate validator unavailable");
    vi.mocked(assertCoordinatePairing).mockImplementationOnce(() => {
      throw unexpected;
    });

    await expect(
      handleCreateEvent(
        fakeContext({
          title: "Coverage event",
          slug: "coverage-event",
          date: "2026-08-02",
          timezone: "Europe/Warsaw",
          latitude: 52.23,
          longitude: 21.01,
        }),
        {} as PrismaClient,
      ),
    ).rejects.toBe(unexpected);
  });
});
