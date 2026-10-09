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

type DeliveryRow = { status: string; recipient_email: string | null };

const LIVE_ROW: DeliveryRow = { status: "queued", recipient_email: "guest@example.com" };

/**
 * A prisma stand-in. The last check before sending reads the deliveries through a transaction,
 * after locking their attendees: `rows` is what that read finds (a missing key is a live row, an
 * undefined value is a row that no longer exists), `erasedAttendees` the attendees that are erased.
 * No delivery is addressed to anyone but its own attendee, so the read for override addresses
 * (the only raw query that names the deliveries) finds nothing.
 */
function fakePrisma(
  updateMany: ReturnType<typeof vi.fn>,
  rows: Record<string, DeliveryRow | undefined> = {},
  erasedAttendees: string[] = [],
): PrismaClient {
  const tx = {
    $queryRaw: vi.fn(async (strings: TemplateStringsArray) =>
      strings.join("").includes('"EmailDelivery"')
        ? []
        : [
            { id: "att-1", erased_at: erasedAttendees.includes("att-1") ? new Date() : null },
            { id: "att-2", erased_at: erasedAttendees.includes("att-2") ? new Date() : null },
          ],
    ),
    emailDelivery: {
      findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.flatMap((id) => {
          const row = id in rows ? rows[id] : LIVE_ROW;
          return row ? [{ id, ...row }] : [];
        }),
      ),
    },
  };
  return {
    $transaction: async (callback: (client: typeof tx) => unknown) => callback(tx),
    emailDelivery: { updateMany },
  } as unknown as PrismaClient;
}

describe("deliverPendingBatch", () => {
  it("returns 0 after marking rows failed when the adapter send throws a soft error", async () => {
    const update = vi.fn(async () => ({}));
    const prisma = fakePrisma(update);
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
        where: { id: "del-soft", recipient_email: { not: null } },
        data: expect.objectContaining({ status: "failed" }),
      }),
    );
  });

  it("rethrows MailDestinationError after marking rows failed so API mappers can return 422", async () => {
    const update = vi.fn(async () => ({}));
    const prisma = fakePrisma(update);
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
        where: { id: "del-dest", recipient_email: { not: null } },
        data: expect.objectContaining({ status: "failed" }),
      }),
    );
  });

  it("rethrows duck-typed destination failures when class identity does not match", async () => {
    const update = vi.fn(async () => ({}));
    const prisma = fakePrisma(update);
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
    const prisma = fakePrisma(update);
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

  describe("the last check before sending", () => {
    const acceptingAdapter = () => {
      const send = vi.fn(async (message: MailMessage): Promise<SendResult> => ({
        status: "accepted",
        provider: "smtp",
        providerMessageId: `msg-${message.idempotencyKey}`,
        idempotencyKey: message.idempotencyKey,
      }));
      const adapter: MailerAdapter = { provider: "smtp", send, close: vi.fn(async () => undefined) };
      return { adapter, send };
    };

    it("hands the mailer only the deliveries that are still sendable", async () => {
      const update = vi.fn(async () => ({}));
      const prisma = fakePrisma(update, {
        "del-cancelled": { status: "cancelled", recipient_email: "guest@example.com" },
        "del-emptied": { status: "queued", recipient_email: null },
        "del-gone": undefined,
      });
      const { adapter, send } = acceptingAdapter();
      const pending = [
        pendingFixture("del-cancelled"),
        pendingFixture("del-emptied"),
        pendingFixture("del-gone"),
        { ...pendingFixture("del-live"), idempotencyKey: "att-1:live" },
      ];

      const sent = await deliverPendingBatch(adapter, pending, prisma);

      expect(sent).toBe(1);
      expect(send).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: "att-1:live" }));
      expect(update).toHaveBeenCalledTimes(1);
      expect(update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "del-live", recipient_email: { not: null } } }));
    });

    it("sends nothing, and writes nothing, when none of them is", async () => {
      const update = vi.fn(async () => ({}));
      const prisma = fakePrisma(update, { "del-a": { status: "cancelled", recipient_email: null } });
      const { adapter, send } = acceptingAdapter();

      expect(await deliverPendingBatch(adapter, [pendingFixture("del-a")], prisma)).toBe(0);

      expect(send).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
    });

    it("leaves out the deliveries of an erased attendee even when the row still looks sendable", async () => {
      const update = vi.fn(async () => ({}));
      const prisma = fakePrisma(update, {}, ["att-1"]);
      const { adapter, send } = acceptingAdapter();
      const live = { ...pendingFixture("del-b"), attendeeId: "att-2", idempotencyKey: "att-2:initial" };

      expect(await deliverPendingBatch(adapter, [pendingFixture("del-a"), live], prisma)).toBe(1);

      expect(send).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: "att-2:initial" }));
    });
  });
});
