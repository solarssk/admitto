import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@admitto/db";
import { createTestPrismaClient } from "@admitto/db/testing";
import { createSession, hashPassword, SESSION_STAGE } from "@admitto/auth";
import { createApp } from "../../src/app.js";
import { sessionCookieFor } from "../helpers/session-cookie.js";

const FIXTURE_EMAIL = "well-known-change-password@example.com";

let prisma: PrismaClient;
let app: ReturnType<typeof createApp>;
let userId: string;

beforeAll(async () => {
  prisma = createTestPrismaClient();
  await prisma.session.deleteMany({ where: { user: { email: FIXTURE_EMAIL } } });
  await prisma.user.deleteMany({ where: { email: FIXTURE_EMAIL } });
  const password_hash = await hashPassword("well-known-pass-123");
  const user = await prisma.user.create({ data: { email: FIXTURE_EMAIL, password_hash } });
  userId = user.id;

  app = createApp({ prisma });
});

afterAll(async () => {
  await prisma.session.deleteMany({ where: { user_id: userId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma?.$disconnect();
});

describe("GET /.well-known/change-password", () => {
  it("redirects to /account when there is no session cookie at all", async () => {
    const res = await app.request("/.well-known/change-password", { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/account");
  });

  it("redirects to /change-password only for a CHANGE_PASSWORD_REQUIRED partial session", async () => {
    const { rawToken } = await createSession(prisma, {
      userId,
      stage: SESSION_STAGE.CHANGE_PASSWORD_REQUIRED,
    });
    const res = await app.request("/.well-known/change-password", {
      redirect: "manual",
      headers: { Cookie: `admitto_session=${rawToken}` },
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/change-password");
  });

  it("redirects a normal signed-in staff member (full session) to /account, not the forced-change page", async () => {
    const cookie = await sessionCookieFor(prisma, userId);
    const res = await app.request("/.well-known/change-password", {
      redirect: "manual",
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/account");
  });

  it("redirects to /account for a garbage/expired cookie instead of erroring", async () => {
    const res = await app.request("/.well-known/change-password", {
      redirect: "manual",
      headers: { Cookie: "admitto_session=not-a-real-token" },
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/account");
  });
});
