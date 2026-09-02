import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { PassCreatorClient } from "@admitto/wallet";
import { encryptToString } from "@admitto/crypto";
import { arg, backfillEvent, hasFlag } from "../../src/scripts/backfill-wallet-first-confirmed.js";

const ORG_ID = "org-backfill-first-confirmed";
const EVENT_ID = "evt-backfill-first-confirmed";
const ATT_CONFIRMED = "att-backfill-confirmed";
const ATT_NOT_CONFIRMED = "att-backfill-not-confirmed";
const ATT_ALREADY_SET = "att-backfill-already-set";

let prisma: PrismaClient;

function makeEvent(overrides: Partial<{ wallet_template_id: string | null; wallet_api_key_enc: string | null }> = {}) {
  return {
    id: EVENT_ID,
    title: "Backfill Test Event",
    wallet_template_id: "tmpl-backfill",
    wallet_api_key_enc: encryptToString("fake-api-key"),
    ...overrides,
  };
}

beforeAll(async () => {
  prisma = createTestPrismaClient();
  await prisma.walletPass.deleteMany({ where: { attendee_id: { in: [ATT_CONFIRMED, ATT_NOT_CONFIRMED, ATT_ALREADY_SET] } } });
  await prisma.attendee.deleteMany({ where: { event_id: EVENT_ID } });
  await prisma.event.deleteMany({ where: { id: EVENT_ID } });
  await prisma.organization.deleteMany({ where: { id: ORG_ID } });
  await prisma.organization.create({ data: { id: ORG_ID, name: "Org", slug: "backfill-first-confirmed-org" } });
  await prisma.event.create({
    data: {
      id: EVENT_ID,
      title: "Backfill Test Event",
      slug: "backfill-test-event",
      date: new Date("2026-09-01"),
      organization_id: ORG_ID,
      wallet_enabled: true,
      wallet_template_id: "tmpl-backfill",
    },
  });
  await prisma.attendee.createMany({
    data: [
      { id: ATT_CONFIRMED, event_id: EVENT_ID, email: "confirmed@example.com", name: "Confirmed Guest", status: "registered" },
      { id: ATT_NOT_CONFIRMED, event_id: EVENT_ID, email: "not-confirmed@example.com", name: "Not Confirmed Guest", status: "registered" },
      { id: ATT_ALREADY_SET, event_id: EVENT_ID, email: "already-set@example.com", name: "Already Set Guest", status: "registered" },
    ],
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await prisma.walletPass.deleteMany({ where: { attendee_id: { in: [ATT_CONFIRMED, ATT_NOT_CONFIRMED, ATT_ALREADY_SET] } } });
});

afterAll(async () => {
  await prisma.attendee.deleteMany({ where: { event_id: EVENT_ID } });
  await prisma.event.deleteMany({ where: { id: EVENT_ID } });
  await prisma.organization.deleteMany({ where: { id: ORG_ID } });
  await prisma?.$disconnect();
});

describe("arg/hasFlag", () => {
  it("arg reads the value following a --name flag, or undefined when absent or trailing with no value", () => {
    expect(arg("event-id", ["--event-id", "evt-1"])).toBe("evt-1");
    expect(arg("event-id", ["--dry-run"])).toBeUndefined();
    expect(arg("event-id", ["--event-id"])).toBeUndefined();
  });

  it("hasFlag reports whether a bare --name flag is present", () => {
    expect(hasFlag("dry-run", ["--dry-run"])).toBe(true);
    expect(hasFlag("dry-run", ["--event-id", "evt-1"])).toBe(false);
  });
});

describe("backfillEvent", () => {
  it("fills first_confirmed_at for a confirmed pass from PassCreator's firstDownloadedAt, leaves a non-confirmed pass untouched", async () => {
    await prisma.walletPass.createMany({
      data: [
        {
          attendee_id: ATT_CONFIRMED,
          provider: "passcreator",
          user_provided_id: `admitto:${EVENT_ID}:${ATT_CONFIRMED}`,
          status: "active",
          apple_active_registrations: 1,
        },
        {
          attendee_id: ATT_NOT_CONFIRMED,
          provider: "passcreator",
          user_provided_id: `admitto:${EVENT_ID}:${ATT_NOT_CONFIRMED}`,
          status: "active",
          apple_active_registrations: 0,
          google_active_registrations: 0,
        },
      ],
    });
    const listSpy = vi.spyOn(PassCreatorClient.prototype, "listWebhooks").mockResolvedValue([]);
    const subscribeSpy = vi.spyOn(PassCreatorClient.prototype, "subscribeWebhook").mockResolvedValue(undefined);
    const statusSpy = vi.spyOn(PassCreatorClient.prototype, "getRegistrationStatus").mockResolvedValue({
      appleActiveRegistrations: 1,
      appleInactiveRegistrations: 0,
      googleActiveRegistrations: 0,
      googleInactiveRegistrations: 0,
      firstDownloadedAt: "2026-08-01 10:00:00",
    });

    await backfillEvent(prisma, makeEvent(), false);

    expect(subscribeSpy).toHaveBeenCalled();
    expect(statusSpy).toHaveBeenCalledExactlyOnceWith(`admitto:${EVENT_ID}:${ATT_CONFIRMED}`);
    const confirmedRow = await prisma.walletPass.findUnique({ where: { attendee_id: ATT_CONFIRMED } });
    expect(confirmedRow?.first_confirmed_at).toEqual(new Date("2026-08-01T10:00:00.000Z"));
    const notConfirmedRow = await prisma.walletPass.findUnique({ where: { attendee_id: ATT_NOT_CONFIRMED } });
    expect(notConfirmedRow?.first_confirmed_at).toBeNull();
    listSpy.mockRestore();
  });

  it("skips a pass whose first_confirmed_at is already set - never queries PassCreator for it", async () => {
    const already = new Date("2026-01-01T00:00:00.000Z");
    await prisma.walletPass.create({
      data: {
        attendee_id: ATT_ALREADY_SET,
        provider: "passcreator",
        user_provided_id: `admitto:${EVENT_ID}:${ATT_ALREADY_SET}`,
        status: "active",
        apple_active_registrations: 1,
        first_confirmed_at: already,
      },
    });
    vi.spyOn(PassCreatorClient.prototype, "listWebhooks").mockResolvedValue([]);
    vi.spyOn(PassCreatorClient.prototype, "subscribeWebhook").mockResolvedValue(undefined);
    const statusSpy = vi.spyOn(PassCreatorClient.prototype, "getRegistrationStatus");

    await backfillEvent(prisma, makeEvent(), false);

    expect(statusSpy).not.toHaveBeenCalled();
    const row = await prisma.walletPass.findUnique({ where: { attendee_id: ATT_ALREADY_SET } });
    expect(row?.first_confirmed_at).toEqual(already);
  });

  it("does not write anything in dry-run mode, but still reports what it would fill", async () => {
    await prisma.walletPass.create({
      data: {
        attendee_id: ATT_CONFIRMED,
        provider: "passcreator",
        user_provided_id: `admitto:${EVENT_ID}:${ATT_CONFIRMED}`,
        status: "active",
        apple_active_registrations: 1,
      },
    });
    const subscribeSpy = vi.spyOn(PassCreatorClient.prototype, "subscribeWebhook").mockResolvedValue(undefined);
    vi.spyOn(PassCreatorClient.prototype, "getRegistrationStatus").mockResolvedValue({
      appleActiveRegistrations: 1,
      appleInactiveRegistrations: 0,
      googleActiveRegistrations: 0,
      googleInactiveRegistrations: 0,
      firstDownloadedAt: "2026-08-01 10:00:00",
    });

    await backfillEvent(prisma, makeEvent(), true);

    expect(subscribeSpy).not.toHaveBeenCalled();
    const row = await prisma.walletPass.findUnique({ where: { attendee_id: ATT_CONFIRMED } });
    expect(row?.first_confirmed_at).toBeNull();
  });

  it("skips a candidate whose firstDownloadedAt is null or unparseable, without crashing the whole event", async () => {
    await prisma.walletPass.create({
      data: {
        attendee_id: ATT_CONFIRMED,
        provider: "passcreator",
        user_provided_id: `admitto:${EVENT_ID}:${ATT_CONFIRMED}`,
        status: "active",
        apple_active_registrations: 1,
      },
    });
    vi.spyOn(PassCreatorClient.prototype, "listWebhooks").mockResolvedValue([]);
    vi.spyOn(PassCreatorClient.prototype, "subscribeWebhook").mockResolvedValue(undefined);
    vi.spyOn(PassCreatorClient.prototype, "getRegistrationStatus").mockResolvedValue({
      appleActiveRegistrations: 1,
      appleInactiveRegistrations: 0,
      googleActiveRegistrations: 0,
      googleInactiveRegistrations: 0,
      firstDownloadedAt: null,
    });

    await expect(backfillEvent(prisma, makeEvent(), false)).resolves.toBeUndefined();
    const row = await prisma.walletPass.findUnique({ where: { attendee_id: ATT_CONFIRMED } });
    expect(row?.first_confirmed_at).toBeNull();
  });

  it("continues past a single pass's PassCreator call failing, instead of aborting the whole event", async () => {
    await prisma.walletPass.createMany({
      data: [
        {
          attendee_id: ATT_CONFIRMED,
          provider: "passcreator",
          user_provided_id: `admitto:${EVENT_ID}:${ATT_CONFIRMED}`,
          status: "active",
          apple_active_registrations: 1,
        },
        {
          attendee_id: ATT_ALREADY_SET,
          provider: "passcreator",
          user_provided_id: `admitto:${EVENT_ID}:${ATT_ALREADY_SET}`,
          status: "active",
          google_active_registrations: 1,
        },
      ],
    });
    vi.spyOn(PassCreatorClient.prototype, "listWebhooks").mockResolvedValue([]);
    vi.spyOn(PassCreatorClient.prototype, "subscribeWebhook").mockResolvedValue(undefined);
    vi.spyOn(PassCreatorClient.prototype, "getRegistrationStatus").mockImplementation(async (userProvidedId: string) => {
      if (userProvidedId.includes(ATT_CONFIRMED)) throw new Error("PassCreator down");
      return {
        appleActiveRegistrations: 0,
        appleInactiveRegistrations: 0,
        googleActiveRegistrations: 1,
        googleInactiveRegistrations: 0,
        firstDownloadedAt: "2026-08-05 09:00:00",
      };
    });

    await expect(backfillEvent(prisma, makeEvent(), false)).resolves.toBeUndefined();
    const failedRow = await prisma.walletPass.findUnique({ where: { attendee_id: ATT_CONFIRMED } });
    expect(failedRow?.first_confirmed_at).toBeNull();
    const succeededRow = await prisma.walletPass.findUnique({ where: { attendee_id: ATT_ALREADY_SET } });
    expect(succeededRow?.first_confirmed_at).toEqual(new Date("2026-08-05T09:00:00.000Z"));
  });

  it("skips the whole event's backfill (but still attempted the webhook re-subscribe) when the API key fails to decrypt", async () => {
    await prisma.walletPass.create({
      data: {
        attendee_id: ATT_CONFIRMED,
        provider: "passcreator",
        user_provided_id: `admitto:${EVENT_ID}:${ATT_CONFIRMED}`,
        status: "active",
        apple_active_registrations: 1,
      },
    });
    vi.spyOn(PassCreatorClient.prototype, "listWebhooks").mockResolvedValue([]);
    vi.spyOn(PassCreatorClient.prototype, "subscribeWebhook").mockResolvedValue(undefined);
    const statusSpy = vi.spyOn(PassCreatorClient.prototype, "getRegistrationStatus");

    await expect(backfillEvent(prisma, makeEvent({ wallet_api_key_enc: "not-valid-ciphertext" }), false)).resolves.toBeUndefined();

    expect(statusSpy).not.toHaveBeenCalled();
    const row = await prisma.walletPass.findUnique({ where: { attendee_id: ATT_CONFIRMED } });
    expect(row?.first_confirmed_at).toBeNull();
  });

  it("continues to the backfill when the webhook re-subscribe itself throws", async () => {
    await prisma.walletPass.create({
      data: {
        attendee_id: ATT_CONFIRMED,
        provider: "passcreator",
        user_provided_id: `admitto:${EVENT_ID}:${ATT_CONFIRMED}`,
        status: "active",
        apple_active_registrations: 1,
      },
    });
    vi.spyOn(PassCreatorClient.prototype, "listWebhooks").mockRejectedValue(new Error("PassCreator down"));
    vi.spyOn(PassCreatorClient.prototype, "getRegistrationStatus").mockResolvedValue({
      appleActiveRegistrations: 1,
      appleInactiveRegistrations: 0,
      googleActiveRegistrations: 0,
      googleInactiveRegistrations: 0,
      firstDownloadedAt: "2026-08-01 10:00:00",
    });

    await expect(backfillEvent(prisma, makeEvent(), false)).resolves.toBeUndefined();
    const row = await prisma.walletPass.findUnique({ where: { attendee_id: ATT_CONFIRMED } });
    expect(row?.first_confirmed_at).toEqual(new Date("2026-08-01T10:00:00.000Z"));
  });
});
