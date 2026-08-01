import { Prisma, type PrismaClient } from "@admitto/db";
import type { Context } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@admitto/location", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@admitto/location")>();
  return {
    ...actual,
    assertCoordinatePairing: vi.fn(actual.assertCoordinatePairing),
    normalizeEventLocationInput: vi.fn(actual.normalizeEventLocationInput),
  };
});

import { assertCoordinatePairing, normalizeEventLocationInput } from "@admitto/location";
import { handlePutEventLocation } from "../../src/admin/event-location-routes.js";

function fkMissingEventError(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Foreign key constraint violated", {
    code: "P2003",
    clientVersion: "test",
  });
}

function fakeContext(body: unknown): Context {
  return {
    req: {
      param: (key: string) => (key === "eventId" ? "evt-1" : undefined),
      json: async () => body,
      header: () => undefined,
      raw: { headers: new Headers() },
    },
    get: (key: string) => {
      if (key === "auth") return { userId: "user-1", sessionId: "sess-1" };
      return undefined;
    },
    json: (payload: unknown, status?: number) =>
      Response.json(payload, { status: status ?? 200 }),
  } as unknown as Context;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("handlePutEventLocation — transaction failure mapping", () => {
  it("maps a concurrent event-delete FK rejection (P2003) to 404 not_found", async () => {
    const db = {
      event: {
        findUnique: vi.fn().mockResolvedValue({ organization_id: "org-1" }),
      },
      eventLocation: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      $transaction: vi.fn().mockRejectedValue(fkMissingEventError()),
    } as unknown as PrismaClient;

    const res = await handlePutEventLocation(
      fakeContext({ venue_name: "Hall", latitude: 52.23, longitude: 21.01 }),
      db,
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });

  it("rethrows a non-Prisma transaction failure", async () => {
    const unexpected = new Error("database unavailable");
    const db = {
      event: {
        findUnique: vi.fn().mockResolvedValue({ organization_id: "org-1" }),
      },
      eventLocation: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
      $transaction: vi.fn().mockRejectedValue(unexpected),
    } as unknown as PrismaClient;

    await expect(
      handlePutEventLocation(
        fakeContext({ venue_name: "Hall", latitude: 52.23, longitude: 21.01 }),
        db,
      ),
    ).rejects.toBe(unexpected);
  });
});

describe("handlePutEventLocation — unexpected location validation failures", () => {
  it("rethrows an unexpected normalization error", async () => {
    const unexpected = new Error("normalizer unavailable");
    vi.mocked(normalizeEventLocationInput).mockImplementationOnce(() => {
      throw unexpected;
    });

    await expect(
      handlePutEventLocation(fakeContext({ venue_name: "Hall" }), {} as PrismaClient),
    ).rejects.toBe(unexpected);
  });

  it("rethrows an unexpected coordinate-pairing error", async () => {
    const unexpected = new Error("coordinate validator unavailable");
    vi.mocked(assertCoordinatePairing).mockImplementationOnce(() => {
      throw unexpected;
    });
    const db = {
      event: {
        findUnique: vi.fn().mockResolvedValue({ organization_id: "org-1" }),
      },
      eventLocation: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    } as unknown as PrismaClient;

    await expect(
      handlePutEventLocation(
        fakeContext({ venue_name: "Hall", latitude: 52.23, longitude: 21.01 }),
        db,
      ),
    ).rejects.toBe(unexpected);
  });
});
