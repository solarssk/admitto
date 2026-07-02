import type { Context } from "hono";
import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import {
  LOGIN_NEXT,
  createUser,
  login,
  markSetupIncomplete,
  normalizeEmail,
} from "@admitto/auth";
import { resolveClientIp } from "./rate-limit/client-ip.js";
import { setSessionCookie } from "./auth/routes.js";
import {
  getSetupPageSecurityHeaders,
  renderSetupPage,
  type SetupErrorCode,
  type SetupFormValues,
} from "./setup-page.js";

const DISPLAY_NAME_MAX = 120;
const PASSWORD_MIN = 12;

class SetupAlreadyInitializedError extends Error {
  constructor() {
    super("already_initialized");
    this.name = "SetupAlreadyInitializedError";
  }
}

/** True when no users exist — first-run SSR gate. */
export async function isFirstRunRequired(db: PrismaClient): Promise<boolean> {
  const count = await db.user.count();
  return count === 0;
}

/** Apply setup page security headers and return an HTML response. */
function htmlResponse(c: Context, html: string, status: 200 | 409 = 200): Response {
  for (const [name, value] of Object.entries(getSetupPageSecurityHeaders())) {
    c.header(name, value);
  }
  return c.html(html, status);
}

/** Parse `application/x-www-form-urlencoded` POST body for /setup. */
async function parseSetupForm(c: Context): Promise<Record<string, string>> {
  const contentType = c.req.header("content-type") ?? "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const body = await c.req.parseBody();
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(body)) {
      if (typeof value === "string") out[key] = value;
    }
    return out;
  }
  return {};
}

/** Validate first-run setup form fields before creating the superadmin user. */
function validateSetupForm(form: Record<string, string>): {
  ok: true;
  email: string;
  password: string;
  displayName: string | null;
} | {
  ok: false;
  code: SetupErrorCode;
  values: SetupFormValues;
} {
  const rawEmail = form["email"]?.trim() ?? "";
  const password = form["password"] ?? "";
  const confirm = form["confirm_password"] ?? "";
  const displayNameRaw = form["display_name"]?.trim() ?? "";
  const values: SetupFormValues = {
    email: rawEmail || undefined,
    display_name: displayNameRaw || undefined,
  };

  let email: string;
  try {
    email = normalizeEmail(rawEmail);
    if (!email.includes("@")) throw new Error("invalid");
  } catch {
    return { ok: false, code: "invalid_email", values };
  }

  if (password.length < PASSWORD_MIN) {
    return { ok: false, code: "password_too_short", values };
  }
  if (password !== confirm) {
    return { ok: false, code: "password_mismatch", values };
  }

  const displayName =
    displayNameRaw.length > DISPLAY_NAME_MAX
      ? displayNameRaw.slice(0, DISPLAY_NAME_MAX)
      : displayNameRaw || null;

  return { ok: true, email, password, displayName };
}

/** GET /setup — bootstrap form when database has no users. */
export async function handleGetSetup(c: Context, db: PrismaClient): Promise<Response> {
  if (!(await isFirstRunRequired(db))) {
    return c.redirect("/login", 302);
  }
  return htmlResponse(c, renderSetupPage());
}

/** POST /setup — create superadmin, mark setup incomplete, auto-login → MFA enroll. */
export async function handlePostSetup(c: Context, db: PrismaClient): Promise<Response> {
  if (!(await isFirstRunRequired(db))) {
    return c.json({ code: "already_initialized" }, 409);
  }

  const form = await parseSetupForm(c);
  const validated = validateSetupForm(form);
  if (!validated.ok) {
    return htmlResponse(c, renderSetupPage(validated.code, validated.values));
  }

  const { email, password, displayName } = validated;

  try {
    await db.$transaction(
      async (tx) => {
        if ((await tx.user.count()) > 0) {
          throw new SetupAlreadyInitializedError();
        }
        const user = await createUser(tx, {
          email,
          password,
          displayName: displayName ?? undefined,
          isActive: true,
        });
        await tx.roleAssignment.create({
          data: {
            user_id: user.id,
            role: "superadmin",
            scope_type: "instance",
            scope_id: null,
          },
        });
        await markSetupIncomplete(tx);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (err) {
    if (
      err instanceof SetupAlreadyInitializedError ||
      (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2034")
    ) {
      return c.json({ code: "already_initialized" }, 409);
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return htmlResponse(
        c,
        renderSetupPage("email_taken", { email, display_name: displayName ?? undefined }),
      );
    }
    throw err;
  }

  const result = await login(db, {
    email,
    password,
    ip: resolveClientIp(c),
    userAgent: c.req.header("user-agent"),
  });

  if (!result.ok) {
    return c.redirect("/login", 302);
  }

  setSessionCookie(c, result.rawToken);

  if (result.next === LOGIN_NEXT.MFA_REQUIRED) {
    return c.redirect("/mfa/verify", 302);
  }
  if (result.next === LOGIN_NEXT.ENROLLMENT_REQUIRED) {
    return c.redirect("/mfa/enroll", 302);
  }
  return c.redirect("/admin", 302);
}
