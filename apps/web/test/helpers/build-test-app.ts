import { PrismaClient } from "@admitto/db";
import { createApp } from "../../src/app.js";
import { createRateLimitStore } from "../../src/rate-limit/index.js";

/** Builds a createApp() instance with the fixed options most integration test files share
 * (bearer check-in allowed, the fixture admin dist, a fresh in-memory rate limit store), leaving
 * only the file-specific checkinToken/adminDistRoot to pass in. */
export function buildTestApp(opts: {
  prisma: PrismaClient;
  checkinToken: string;
  adminDistRoot: string;
}): ReturnType<typeof createApp> {
  return createApp({
    prisma: opts.prisma,
    checkinToken: opts.checkinToken,
    allowCheckinBearer: true,
    baseUrl: "https://tickets.example.com",
    rateLimitStore: createRateLimitStore(),
    skipCheckinBootValidation: true,
    adminDistRoot: opts.adminDistRoot,
  });
}
