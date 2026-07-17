import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { assertTestDatabaseUrl } from "../src/testDbGuard.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_ROOT = path.resolve(__dirname, "..");

const EVENT_ID = "evt-rsvp-check";
const ORG_ID = "org-rsvp-check";

let prisma: PrismaClient | undefined;

beforeAll(async () => {
  assertTestDatabaseUrl(process.env.DATABASE_URL ?? "");
  execSync("npx prisma migrate reset --force --skip-seed", {
    cwd: DB_ROOT,
    env: { ...process.env },
    stdio: "pipe",
  });
  prisma = new PrismaClient();
  await prisma.organization.create({
    data: { id: ORG_ID, name: "RSVP Constraint Org", slug: "rsvp-constraint" },
  });
  await prisma.event.create({
    data: {
      id: EVENT_ID,
      title: "Constraint Gala",
      slug: "constraint-gala",
      date: new Date("2026-09-01"),
      organization_id: ORG_ID,
    },
  });
});

afterAll(async () => {
  await prisma?.$disconnect();
});

describe("Attendee.rsvp_status DB constraint", () => {
  it("rejects values outside the RSVP status enum", async () => {
    const attendee = await prisma!.attendee.create({
      data: {
        event_id: EVENT_ID,
        email: "rsvp-check@example.com",
        name: "RSVP Check",
      },
    });

    await prisma!.$executeRaw`UPDATE "Attendee" SET "rsvp_status" = 'confirmed' WHERE "id" = ${attendee.id}`;

    await expect(
      prisma!.$executeRaw`UPDATE "Attendee" SET "rsvp_status" = 'bogus' WHERE "id" = ${attendee.id}`,
    ).rejects.toThrow();
  });
});
