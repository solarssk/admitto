import type { Context, Next } from "hono";
import type { PrismaClient } from "@prisma/client";
import { resolveStaffAuthFromRequest } from "./resolve-staff-auth.js";

/** Accept Cloudflare Access JWT or session for staff bootstrap APIs (`/api/auth/me`, `/api/staff/theme`). */
export function createStaffAuthGate(prisma: PrismaClient) {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const result = await resolveStaffAuthFromRequest(c, prisma);
    if (result.status === "invalid_cf_jwt") {
      return c.json({ error: "cf_access_jwt_invalid" }, 403);
    }
    if (result.status === "unauthenticated") {
      return c.json({ error: "unauthorized" }, 401);
    }
    c.set("auth", result.auth);
    await next();
  };
}
