import { describe, expect, it, vi } from "vitest";
import type { Context } from "hono";
import type { AdmitResult } from "@admitto/tickets";
import { publishCheckinIfValid, publishActivityChanged } from "../src/admin/checkin-sse-publish.js";
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
      blocked: false,
    },
  };
}

describe("publishCheckinIfValid", () => {
  it("publishes without a database lookup when device label is provided", () => {
    const publishSpy = vi.spyOn(sseChannel, "publish");

    const c = {
      get: (key: string) => (key === "operatorUserId" ? "op-1" : undefined),
    } as unknown as Context;

    publishCheckinIfValid(c, "evt-1", validResult(), "Gate A");

    expect(publishSpy).toHaveBeenCalledWith(
      "evt-1",
      expect.objectContaining({ deviceLabel: "Gate A", operatorId: "op-1" }),
    );
    publishSpy.mockRestore();
  });
});

describe("publishActivityChanged", () => {
  it("publishes a payload-less activity_changed event for the given event", () => {
    const publishSpy = vi.spyOn(sseChannel, "publish");

    publishActivityChanged("evt-1");

    expect(publishSpy).toHaveBeenCalledWith("evt-1", { type: "activity_changed" });
    publishSpy.mockRestore();
  });
});
