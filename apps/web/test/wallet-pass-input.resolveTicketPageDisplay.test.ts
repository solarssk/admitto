import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@admitto/db";
import { resolveTicketPageDisplay } from "../src/wallet-pass-input.js";

const loadEventTicketTypes = vi.fn();

vi.mock("@admitto/tickets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@admitto/tickets")>();
  return { ...actual, loadEventTicketTypes: (...args: unknown[]) => loadEventTicketTypes(...args) };
});

function makeResolved(ticketType: string | null) {
  return {
    attendee: { ticket_type: ticketType },
    event: { id: "evt-1" },
  } as unknown as Parameters<typeof resolveTicketPageDisplay>[1];
}

describe("resolveTicketPageDisplay — ticket type label resolution edge cases", () => {
  it("returns the resolved ticket unchanged when the catalog has no matching key", async () => {
    loadEventTicketTypes.mockResolvedValueOnce([{ key: "vip", label: "VIP" }]);
    const resolved = makeResolved("press_pass");

    const result = await resolveTicketPageDisplay({} as PrismaClient, resolved);

    expect(result.attendee.ticket_type).toBe("press_pass");
  });

  it("fails open to the raw ticket type when loadEventTicketTypes throws", async () => {
    loadEventTicketTypes.mockRejectedValueOnce(new Error("db down"));
    const resolved = makeResolved("press_pass");

    const result = await resolveTicketPageDisplay({} as PrismaClient, resolved);

    expect(result.attendee.ticket_type).toBe("press_pass");
  });
});
