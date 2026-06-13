import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { PrismaClient } from "@prisma/client";
import { SESSION_COOKIE_NAME, login, logout, validateSession } from "@admitto/auth";
import { clientIpFromHeaders } from "../rate-limit/client-ip.js";

const AUTH_ERROR = { error: "unauthorized" } as const;

function sessionCookieOptions(): {
  httpOnly: true;
  secure: boolean;
  sameSite: "Lax";
  path: string;
} {
  return {
    httpOnly: true,
    secure: process.env["NODE_ENV"] !== "development",
    sameSite: "Lax",
    path: "/",
  };
}

export function setSessionCookie(c: Context, rawToken: string): void {
  setCookie(c, SESSION_COOKIE_NAME, rawToken, sessionCookieOptions());
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE_NAME, { path: "/" });
}

export async function handleLogin(c: Context, db: PrismaClient): Promise<Response> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON" }, 400);
  }

  if (!body || typeof body !== "object") {
    return c.json(AUTH_ERROR, 401);
  }

  const { email, password } = body as Record<string, unknown>;
  if (typeof email !== "string" || typeof password !== "string" || !email || !password) {
    return c.json(AUTH_ERROR, 401);
  }

  const result = await login(
    db,
    {
      email,
      password,
      ip: clientIpFromHeaders(c.req.header("x-forwarded-for")),
      userAgent: c.req.header("user-agent"),
    },
    { email },
  );

  if (!result.ok) {
    return c.json(AUTH_ERROR, 401);
  }

  setSessionCookie(c, result.rawToken);
  return c.json({ ok: true }, 200);
}

export async function handleLogout(c: Context, db: PrismaClient): Promise<Response> {
  const rawToken = getCookie(c, SESSION_COOKIE_NAME);
  const validated = rawToken ? await validateSession(db, rawToken) : null;
  await logout(db, validated);
  clearSessionCookie(c);
  return c.json({ ok: true }, 200);
}

export async function handleMe(c: Context, db: PrismaClient): Promise<Response> {
  const auth = c.get("auth");
  const user = await db.user.findUnique({
    where: { id: auth.userId },
    select: {
      id: true,
      email: true,
      display_name: true,
      is_active: true,
      created_at: true,
    },
  });

  if (!user) {
    return c.json(AUTH_ERROR, 401);
  }

  const assignments = await db.roleAssignment.findMany({
    where: { user_id: auth.userId },
    select: {
      role: true,
      scope_type: true,
      scope_id: true,
    },
  });

  return c.json({ user, assignments }, 200);
}
