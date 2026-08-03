import type { PrismaClient } from "@admitto/db";
import {
  MailDestinationError,
  type MailerAdapter,
  type MailMessage,
  type SendResult,
} from "@admitto/mailer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { deliverPendingBatch } from "../src/send.js";

afterEach(() => {
  vi.restoreAllMocks();
});

function pendingFixture(deliveryId: string) {
  return {
    deliveryId,
    attendeeId: "att-1",
    to: "guest@example.com",
    frozenSubject: "Your ticket",
    frozenHtml: "<p>{{ticket_url}}</p>",
    links: {
      ticket_url: "https://tickets.example.com/t/abc",
      qr_image_url: "https://tickets.example.com/q/abc.png",
    },
    idempotencyKey: "att-1:initial",
  };
}

describe("deliverPendingBatch", () => {
  it("returns 0 after marking rows failed when the adapter send throws a soft error", async () => {
    const update = vi.fn(async () => ({}));
    const prisma = { emailDelivery: { update } } as unknown as PrismaClient;
    const adapter: MailerAdapter = {
      provider: "smtp",
      send: vi.fn(async (_message: MailMessage): Promise<SendResult> => {
        throw new Error("transport down");
      }),
      close: vi.fn(async () => undefined),
    };

    const sent = await deliverPendingBatch(adapter, [pendingFixture("del-soft")], prisma);

    expect(sent).toBe(0);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "del-soft" },
        data: expect.objectContaining({ status: "failed" }),
      }),
    );
  });

  it("rethrows MailDestinationError after marking rows failed so API mappers can return 422", async () => {
    const update = vi.fn(async () => ({}));
    const prisma = { emailDelivery: { update } } as unknown as PrismaClient;
    const destErr = new MailDestinationError(
      "mail_destination_blocked",
      "hostname must not resolve to a private or link-local address",
    );
    const adapter: MailerAdapter = {
      provider: "smtp",
      send: vi.fn(async () => {
        throw destErr;
      }),
      close: vi.fn(async () => undefined),
    };

    await expect(
      deliverPendingBatch(adapter, [pendingFixture("del-dest")], prisma),
    ).rejects.toBe(destErr);

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "del-dest" },
        data: expect.objectContaining({ status: "failed" }),
      }),
    );
  });

  it("rethrows duck-typed destination failures when class identity does not match", async () => {
    const update = vi.fn(async () => ({}));
    const prisma = { emailDelivery: { update } } as unknown as PrismaClient;
    const destErr = Object.assign(new Error("hostname could not be resolved"), {
      name: "MailDestinationError",
      code: "mail_destination_unresolved",
    });
    const adapter: MailerAdapter = {
      provider: "smtp",
      send: vi.fn(async () => {
        throw destErr;
      }),
      close: vi.fn(async () => undefined),
    };

    await expect(
      deliverPendingBatch(adapter, [pendingFixture("del-dest-duck")], prisma),
    ).rejects.toBe(destErr);

    expect(update).toHaveBeenCalled();
  });

  it("does not rethrow when name matches but code is not a mail_destination_* string", async () => {
    const update = vi.fn(async () => ({}));
    const prisma = { emailDelivery: { update } } as unknown as PrismaClient;
    const weird = Object.assign(new Error("nope"), {
      name: "MailDestinationError",
      code: 535,
    });
    const adapter: MailerAdapter = {
      provider: "smtp",
      send: vi.fn(async () => {
        throw weird;
      }),
      close: vi.fn(async () => undefined),
    };

    await expect(
      deliverPendingBatch(adapter, [pendingFixture("del-weird")], prisma),
    ).resolves.toBe(0);
    expect(update).toHaveBeenCalled();
  });
});
