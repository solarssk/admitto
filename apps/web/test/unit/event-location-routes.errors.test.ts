import { Prisma, type PrismaClient } from "@admitto/db";
import type { Context } from "hono";
import { describe, expect, it, vi } from "vitest";
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
});
