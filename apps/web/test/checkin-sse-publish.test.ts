import { describe, expect, it, vi } from "vitest";
import type { Context } from "hono";
import type { PrismaClient } from "@prisma/client";
import type { AdmitResult } from "@admitto/tickets";
import { publishCheckinIfValid } from "../src/admin/checkin-sse-publish.js";
import * as sseChannel from "../src/admin/sse-channel.js";

function validResult(): AdmitResult {
  return {
    status: "VALID",
    confirmed: true,
    admittedAt: new Date("2026-07-01T12:00:00.000Z"),
    card: {
      id: "att-1",
      name: "Ada",
      company: null,
      department: null,
      ticket_type: "VIP",
      check_in_status: "admitted",
      admitted_at: "2026-07-01T12:00:00.000Z",
      items: [],
      notes: [],
      warnings: [],
    },
  };
}

describe("publishCheckinIfValid", () => {
  it("does not throw when session lookup fails", async () => {
    const publishSpy = vi.spyOn(sseChannel, "publish");
    const db = {
      session: {
        findUnique: vi.fn().mockRejectedValue(new Error("db blip")),
      },
    } as unknown as PrismaClient;

    const c = {
      get: (key: string) => {
        if (key === "checkinSessionId") return "sess-1";
        if (key === "operatorUserId") return "op-1";
        return undefined;
      },
    } as unknown as Context;

    await expect(publishCheckinIfValid(c, db, "evt-1", validResult())).resolves.toBeUndefined();
    expect(publishSpy).not.toHaveBeenCalled();
    publishSpy.mockRestore();
  });
});
