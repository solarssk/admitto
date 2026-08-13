import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@admitto/db";
import { resolveTicketPageDisplay } from "../src/wallet-pass-input.js";

function makeResolved(ticketType: string | null) {
  return {
    attendee: { ticket_type: ticketType },
    event: { id: "evt-1" },
  } as unknown as Parameters<typeof resolveTicketPageDisplay>[1];
}

function makeDb(ticketTypeFindMany: () => Promise<unknown>): PrismaClient {
  return { ticketType: { findMany: ticketTypeFindMany } } as unknown as PrismaClient;
}

describe("resolveTicketPageDisplay — ticket type label resolution edge cases", () => {
  it("returns the resolved ticket unchanged when the catalog has no matching key", async () => {
    const db = makeDb(() => Promise.resolve([{ key: "vip", label: "VIP" }]));
    const resolved = makeResolved("press_pass");

    const result = await resolveTicketPageDisplay(db, resolved);

    expect(result.attendee.ticket_type).toBe("press_pass");
  });

  it("fails open to the raw ticket type when loadEventTicketTypes throws", async () => {
    const db = makeDb(() => Promise.reject(new Error("db down")));
    const resolved = makeResolved("press_pass");

    const result = await resolveTicketPageDisplay(db, resolved);

    expect(result.attendee.ticket_type).toBe("press_pass");
  });
});
