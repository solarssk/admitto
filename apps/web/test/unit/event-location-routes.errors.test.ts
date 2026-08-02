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

vi.mock("../../src/admin/admin-helpers.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/admin/admin-helpers.js")>();
  return {
    ...actual,
    assertEventManageAccess: vi.fn(actual.assertEventManageAccess),
  };
});

import { assertCoordinatePairing, normalizeEventLocationInput } from "@admitto/location";
import { assertEventManageAccess } from "../../src/admin/admin-helpers.js";
import { handleGetEventLocation, handlePutEventLocation } from "../../src/admin/event-location-routes.js";

function fkMissingEventError(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Foreign key constraint violated", {
    code: "P2003",
    clientVersion: "test",
  });
}

function fakeContext(body: unknown, eventId: string | undefined = "evt-1"): Context {
  return {
    req: {
      param: (key: string) => (key === "eventId" ? eventId : undefined),
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

  it("rethrows unexpected transaction failures", async () => {
    const unexpected = new Error("write failed");
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

  it("rethrows a non-LocationValidationError from normalizeEventLocationInput", async () => {
    const unexpected = new Error("normalizer unavailable");
    vi.mocked(normalizeEventLocationInput).mockImplementationOnce(() => {
      throw unexpected;
    });

    await expect(
      handlePutEventLocation(fakeContext({ venue_name: "Hall" }), {} as PrismaClient),
    ).rejects.toBe(unexpected);
  });

  it("rethrows a non-LocationValidationError from coordinate pairing", async () => {
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

describe("event-location handlers — access guards", () => {
  it("GET returns 400 when eventId is missing from the route", async () => {
    const res = await handleGetEventLocation(fakeContext({}, ""), {} as PrismaClient);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "eventId required" });
  });

  it("PUT returns 400 when eventId is missing from the route", async () => {
    const res = await handlePutEventLocation(fakeContext({ venue_name: "Hall" }, ""), {} as PrismaClient);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "eventId required" });
  });

  it("GET returns the forbidden response from assertEventManageAccess", async () => {
    vi.mocked(assertEventManageAccess).mockResolvedValueOnce(
      Response.json({ error: "forbidden" }, { status: 403 }),
    );
    const res = await handleGetEventLocation(fakeContext({}), {} as PrismaClient);
    expect(res.status).toBe(403);
  });

  it("GET returns 404 when the event does not exist", async () => {
    vi.mocked(assertEventManageAccess).mockResolvedValueOnce(null);
    const db = {
      event: { findUnique: vi.fn().mockResolvedValue(null) },
    } as unknown as PrismaClient;
    const res = await handleGetEventLocation(fakeContext({}), db);
    expect(res.status).toBe(404);
  });

  it("GET serializes a found location after access succeeds", async () => {
    vi.mocked(assertEventManageAccess).mockResolvedValueOnce(null);
    const db = {
      event: { findUnique: vi.fn().mockResolvedValue({ id: "evt-1" }) },
      eventLocation: {
        findUnique: vi.fn().mockResolvedValue({
          event_id: "evt-1",
          venue_name: "Hall",
          formatted_address: null,
          address_components: null,
          latitude: null,
          longitude: null,
          map_zoom: null,
          directions: null,
          accessibility: null,
          geocoding_provider: null,
          updated_at: new Date("2026-01-01T00:00:00.000Z"),
        }),
      },
    } as unknown as PrismaClient;
    const res = await handleGetEventLocation(fakeContext({}), db);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ venue_name: "Hall" });
  });
});
