import type { Context } from "hono";
import type { PrismaClient } from "@admitto/db";
import {
  canManageInstance,
  getBrandingTheme,
  setBrandingTheme,
  type BrandingCustomFontFamily,
  type BrandingTheme,
} from "@admitto/auth";
import { resolveThemeVars } from "@admitto/ui";
import { bestEffortDeleteReplacedUploadUrls } from "./branding-upload.js";

/** Collect managed font file URLs from a saved theme (custom_font_families variants). */
function customFontUrls(theme: BrandingTheme | null): string[] {
  const urls: string[] = [];
  for (const fam of theme?.custom_font_families ?? []) {
    for (const variant of fam.variants ?? []) {
      if (typeof variant.url === "string") urls.push(variant.url);
    }
  }
  return urls;
}

/** GET /api/staff/theme - any authenticated staff. */
export async function handleGetStaffTheme(c: Context, db: PrismaClient): Promise<Response> {
  const theme = await getBrandingTheme(db);
  const vars = resolveThemeVars(theme);
  return c.json({ theme, vars });
}

/** PUT /api/staff/theme - superadmin only. */
export async function handlePutStaffTheme(c: Context, db: PrismaClient): Promise<Response> {
  const auth = c.get("auth");
  if (!(await canManageInstance(db, auth.userId))) {
    return c.json({ error: "forbidden" }, 403);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid JSON" }, 400);
  }

  if (!body || typeof body !== "object") {
    return c.json({ error: "invalid body" }, 400);
  }

  const previous = await getBrandingTheme(db);

  const raw = body as Record<string, unknown>;
  await setBrandingTheme(db, {
    primary: typeof raw.primary === "string" ? raw.primary : undefined,
    font_family_name: typeof raw.font_family_name === "string" ? raw.font_family_name : undefined,
    ticket_font_family_name:
      typeof raw.ticket_font_family_name === "string" ? raw.ticket_font_family_name : undefined,
    // Shape-cast only - setBrandingTheme's own sanitizeTheme() is the real validation boundary
    // and re-checks every family's name and every variant's weight/style/url at runtime
    // regardless of what's cast here.
    custom_font_families: Array.isArray(raw.custom_font_families)
      ? (raw.custom_font_families as BrandingCustomFontFamily[])
      : undefined,
  });

  const theme = await getBrandingTheme(db);
  // Interim orphan cleanup (ADR 0008): drop font files no longer referenced by the theme.
  await bestEffortDeleteReplacedUploadUrls(customFontUrls(previous), customFontUrls(theme), {
    expectedOrgId: "default",
    expectedKind: "theme",
  });
  return c.json({ theme, vars: resolveThemeVars(theme) });
}
