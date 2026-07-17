import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { backfillAgencyPublicRefs } from "../src/backfill-public-ref.js";
import { assertTestDatabaseUrl } from "../src/testDbGuard.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_ROOT = path.resolve(__dirname, "..");

const EVENT_ID = "evt-backfill";
const ORG_ID = "org-backfill";

let prisma: PrismaClient;

beforeAll(async () => {
  assertTestDatabaseUrl(process.env.DATABASE_URL ?? "");
  execSync("npx prisma db push --force-reset --accept-data-loss", {
    cwd: DB_ROOT,
    env: { ...process.env },
    stdio: "pipe",
  });
  prisma = new PrismaClient();
  await prisma.organization.create({
    data: { id: ORG_ID, name: "Org", slug: "org-backfill" },
  });
  await prisma.event.create({
    data: {
      id: EVENT_ID,
      title: "Gala",
      slug: "gala",
      date: new Date("2026-09-01"),
      organization_id: ORG_ID,
    },
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("backfillAgencyPublicRefs", () => {
  it("assigns unique public_ref to agency rows only", async () => {
    const agency = await prisma.attendee.create({
      data: {
        event_id: EVENT_ID,
        email: "agency@example.com",
        name: "Agency Guest",
        qr_payload: "AGENCY-QR-1",
      },
    });
    const internal = await prisma.attendee.create({
      data: {
        event_id: EVENT_ID,
        email: "internal@example.com",
        name: "Internal Guest",
      },
    });

    expect(agency.public_ref).toBeNull();
    const first = await backfillAgencyPublicRefs(prisma);
    expect(first.updated).toBe(1);

    const agencyAfter = await prisma.attendee.findUniqueOrThrow({ where: { id: agency.id } });
    expect(agencyAfter.public_ref).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const internalAfter = await prisma.attendee.findUniqueOrThrow({ where: { id: internal.id } });
    expect(internalAfter.public_ref).toBeNull();
  });

  it("is idempotent on second run", async () => {
    const before = await prisma.attendee.findMany({
      where: { event_id: EVENT_ID, public_ref: { not: null } },
    });
    const second = await backfillAgencyPublicRefs(prisma);
    expect(second.updated).toBe(0);

    const after = await prisma.attendee.findMany({
      where: { event_id: EVENT_ID, public_ref: { not: null } },
    });
    expect(after.map((a) => a.public_ref).sort()).toEqual(before.map((a) => a.public_ref).sort());
  });
});
